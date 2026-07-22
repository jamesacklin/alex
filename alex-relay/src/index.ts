import { DurableObject } from "cloudflare:workers";
import {
  decodeClientFrame,
  encodeHttpRequest,
  encodeRegisterAck,
  type HeaderPair,
} from "./protocol";

const TUNNEL_PATH = "/_tunnel/ws";
const TUNNEL_TAG = "tunnel";
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

interface SocketAttachment {
  subdomain: string;
  registered: boolean;
}

interface PendingHeaders {
  kind: "headers";
  resolve: (response: Response) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingBody {
  kind: "body";
  writer: WritableStreamDefaultWriter<Uint8Array>;
  writes: Promise<void>;
  timeout?: ReturnType<typeof setTimeout>;
}

type PendingRequest = PendingHeaders | PendingBody;

function validSubdomain(value: string): boolean {
  return value.length > 0
    && value.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function extractSubdomain(hostname: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain.toLowerCase()}`;
  const host = hostname.toLowerCase();
  if (!host.endsWith(suffix)) return null;

  const subdomain = host.slice(0, -suffix.length);
  return validSubdomain(subdomain) ? subdomain : null;
}

function objectForSubdomain(env: Env, subdomain: string): DurableObjectStub<Tunnel> {
  return env.TUNNELS.get(env.TUNNELS.idFromName(subdomain));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === TUNNEL_PATH) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected a WebSocket upgrade", { status: 426 });
      }

      const subdomain = url.searchParams.get("subdomain")?.toLowerCase() ?? "";
      if (!validSubdomain(subdomain)) {
        return new Response("a valid subdomain query parameter is required", { status: 400 });
      }

      const headers = new Headers(request.headers);
      headers.set("x-alex-tunnel-subdomain", subdomain);
      return objectForSubdomain(env, subdomain).fetch(new Request(request, { headers }));
    }

    const subdomain = extractSubdomain(url.hostname, env.BASE_DOMAIN);
    if (!subdomain) {
      return new Response("no tunnel found", { status: 404 });
    }

    return objectForSubdomain(env, subdomain).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Tunnel extends DurableObject<Env> {
  private readonly pending = new Map<bigint, PendingRequest>();
  private nextRequestId = BigInt(Date.now()) << 16n;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === TUNNEL_PATH) return this.acceptTunnel(request);
    return this.proxy(request);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      ws.close(1003, "binary frames required");
      return;
    }

    let frame;
    try {
      frame = decodeClientFrame(message);
    } catch (error) {
      console.warn("invalid tunnel frame", error);
      ws.close(1003, "invalid tunnel frame");
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.registered) {
      if (frame.type !== "register" || frame.subdomain !== attachment?.subdomain) {
        ws.send(encodeRegisterAck(false, "subdomain does not match tunnel URL"));
        ws.close(1008, "registration rejected");
        return;
      }

      attachment.registered = true;
      ws.serializeAttachment(attachment);
      ws.send(encodeRegisterAck(true, "registered"));
      console.log("tunnel connected", { subdomain: attachment.subdomain });
      return;
    }

    switch (frame.type) {
      case "httpResponse":
        this.startResponse(frame.requestId, frame.status, frame.headers);
        break;
      case "responseChunk":
        this.writeResponseChunk(frame.requestId, frame.data);
        break;
      case "responseEnd":
        this.endResponse(frame.requestId);
        break;
      case "pong":
        break;
      default:
        ws.close(1003, "unexpected tunnel frame");
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    console.log("tunnel disconnected", { subdomain: attachment?.subdomain, code, reason });
    await this.failPending("tunnel client disconnected");
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    console.error("tunnel WebSocket error", { subdomain: attachment?.subdomain, error });
    await this.failPending("tunnel client disconnected");
  }

  private acceptTunnel(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    const subdomain = request.headers.get("x-alex-tunnel-subdomain") ?? "";
    if (!validSubdomain(subdomain)) {
      return new Response("invalid tunnel subdomain", { status: 400 });
    }

    const current = this.ctx.getWebSockets(TUNNEL_TAG).find(
      (ws) => ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING,
    );
    if (current) {
      return new Response("subdomain already in use", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [TUNNEL_TAG]);
    server.serializeAttachment({ subdomain, registered: false } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async proxy(request: Request): Promise<Response> {
    const socket = this.ctx.getWebSockets(TUNNEL_TAG).find((candidate) => {
      const attachment = candidate.deserializeAttachment() as SocketAttachment | null;
      return candidate.readyState === WebSocket.OPEN && attachment?.registered;
    });
    if (!socket) {
      return new Response("tunnel not connected", { status: 502 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      return new Response("request body too large", { status: 413 });
    }

    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
      return new Response("request body too large", { status: 413 });
    }

    const requestId = this.nextRequestId++;
    const response = new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(new Response("tunnel request timed out", { status: 504 }));
      }, this.requestTimeoutMs());
      this.pending.set(requestId, { kind: "headers", resolve, timeout });
    });

    const url = new URL(request.url);
    try {
      socket.send(encodeHttpRequest({
        type: "httpRequest",
        requestId,
        method: request.method,
        uri: `${url.pathname}${url.search}`,
        headers: Array.from(request.headers.entries()),
        body,
      }));
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending?.timeout !== undefined) clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      console.warn("failed to send request to tunnel", { requestId: requestId.toString(), error });
      return new Response("tunnel client disconnected", { status: 502 });
    }

    return response;
  }

  private startResponse(requestId: bigint, status: number, headerPairs: HeaderPair[]): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "headers") return;

    clearTimeout(pending.timeout);
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const body: PendingBody = {
      kind: "body",
      writer,
      writes: Promise.resolve(),
    };
    body.timeout = this.newBodyTimeout(requestId, body);
    this.pending.set(requestId, body);

    const headers = new Headers();
    for (const [name, value] of headerPairs) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.append(name, value);
    }

    try {
      pending.resolve(new Response(stream.readable, { status, headers }));
    } catch (error) {
      if (body.timeout !== undefined) clearTimeout(body.timeout);
      this.pending.delete(requestId);
      void writer.abort(error);
      pending.resolve(new Response("invalid response from tunnel client", { status: 502 }));
    }
  }

  private writeResponseChunk(requestId: bigint, data: Uint8Array): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "body") return;

    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending.timeout = this.newBodyTimeout(requestId, pending);
    pending.writes = pending.writes.then(() => pending.writer.write(data)).catch(() => {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      this.pending.delete(requestId);
    });
  }

  private endResponse(requestId: bigint): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "body") return;
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    this.ctx.waitUntil(pending.writes.then(() => pending.writer.close()).catch(() => undefined));
  }

  private async failPending(message: string): Promise<void> {
    const writes: Promise<unknown>[] = [];
    for (const [requestId, pending] of this.pending) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      if (pending.kind === "headers") {
        pending.resolve(new Response(message, { status: 502 }));
      } else {
        writes.push(pending.writer.abort(new Error(message)).catch(() => undefined));
      }
    }
    await Promise.all(writes);
  }

  private requestTimeoutMs(): number {
    const value = Number(this.env.REQUEST_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : 120_000;
  }

  private newBodyTimeout(requestId: bigint, body: PendingBody): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.pending.get(requestId) === body) {
        this.pending.delete(requestId);
        void body.writer.abort(new Error("tunnel response timed out"));
      }
    }, this.requestTimeoutMs());
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
