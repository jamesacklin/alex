import { DurableObject } from "cloudflare:workers";
import {
  PROTOCOL_VERSION,
  decodeClientFrame,
  encodeCancel,
  encodeChallenge,
  encodeHttpRequest,
  encodeRegisterAck,
  type HeaderPair,
} from "./protocol";

const TUNNEL_PATH = "/_tunnel/ws";
const TUNNEL_TAG = "tunnel";

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling on requests in flight through one tunnel.
 *
 * Each pending request holds a promise, a timer and (once headers arrive) a
 * stream, so an unbounded map is an unbounded memory commitment driven by
 * public traffic.
 */
const MAX_PENDING_REQUESTS = 64;

/**
 * Ceiling on response bytes queued for one request, and across the tunnel.
 *
 * The relay reads from the tunnel socket as fast as the client sends and
 * chains `writer.write()` promises. A browser that stops reading therefore
 * used to let bytes pile up with only the *count* of chained promises as
 * any kind of limit. These budgets make the pressure explicit: exceed them
 * and the response is aborted and the client told to stop.
 */
const MAX_QUEUED_BYTES_PER_REQUEST = 8 * 1024 * 1024;
const MAX_QUEUED_BYTES_TOTAL = 32 * 1024 * 1024;

/** A socket must finish registering within this window or be closed. */
const REGISTRATION_DEADLINE_MS = 15_000;

const OWNER_KEY = "owner";
const GENERATION_KEY = "generation";
const SECRET_BYTES = 32;
const NONCE_BYTES = 32;

interface OwnerRecord {
  /** Base64 of the 32-byte shared secret used to verify proofs. */
  secret: string;
  claimedAt: number;
  rotatedAt?: number;
}

interface SocketAttachment {
  subdomain: string;
  registered: boolean;
  /** Per-connection challenge nonce, base64. */
  nonce: string;
  /**
   * Monotonic connection id.
   *
   * Pending requests remember the generation they were issued under, so a
   * close or error event from a *previous* connection cannot fail requests
   * belonging to the current one.
   */
  generation: number;
}

interface PendingHeaders {
  kind: "headers";
  generation: number;
  method: string;
  resolve: (response: Response) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingBody {
  kind: "body";
  generation: number;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  writes: Promise<void>;
  queuedBytes: number;
  timeout?: ReturnType<typeof setTimeout>;
}

type PendingRequest = PendingHeaders | PendingBody;

/** Statuses that must not carry a response body. */
const BODYLESS_STATUSES = new Set([204, 205, 304]);

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
  private queuedBytesTotal = 0;

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
    if (!attachment) {
      ws.close(1011, "socket has no attachment");
      return;
    }

    if (!attachment.registered) {
      await this.handleRegistration(ws, attachment, frame);
      return;
    }

    switch (frame.type) {
      case "httpResponse":
        this.startResponse(frame.requestId, frame.status, frame.headers, attachment.generation);
        break;
      case "responseChunk":
        this.writeResponseChunk(frame.requestId, frame.data, attachment.generation);
        break;
      case "responseEnd":
        this.endResponse(frame.requestId, attachment.generation);
        break;
      case "cancel":
        this.abortRequest(
          frame.requestId,
          attachment.generation,
          "tunnel client aborted the response",
        );
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
    // Only fail requests that belong to *this* connection. A late close
    // event from a replaced socket must not tear down the live one's work.
    await this.failPending("tunnel client disconnected", attachment?.generation);
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    console.error("tunnel WebSocket error", { subdomain: attachment?.subdomain, error });
    await this.failPending("tunnel client disconnected", attachment?.generation);
  }

  /**
   * Verify a registration frame before the socket may serve traffic (F02).
   *
   * Registration used to prove only that the frame's subdomain matched the
   * URL, and nothing about the name was persisted — so after the owner
   * disconnected, anyone could take the name over and receive the requests
   * and cookies intended for it. Ownership is now a stored secret, and
   * every connection has to answer a fresh challenge with
   * `HMAC-SHA256(secret, nonce || subdomain)`.
   */
  private async handleRegistration(
    ws: WebSocket,
    attachment: SocketAttachment,
    frame: ReturnType<typeof decodeClientFrame>,
  ): Promise<void> {
    const reject = (message: string) => {
      ws.send(encodeRegisterAck(false, message));
      ws.close(1008, "registration rejected");
    };

    if (frame.type === "register") {
      // A protocol v1 client. Rejecting it with an explanation is the whole
      // point of keeping the variant around.
      reject(
        `this relay requires tunnel protocol v${PROTOCOL_VERSION}; upgrade Alex to enable public access`,
      );
      return;
    }

    if (frame.type !== "claim" && frame.type !== "prove" && frame.type !== "rotate") {
      reject("expected a claim, prove or rotate frame");
      return;
    }

    if (frame.protocolVersion !== PROTOCOL_VERSION) {
      reject(
        `this relay speaks tunnel protocol v${PROTOCOL_VERSION}, the client speaks v${frame.protocolVersion}`,
      );
      return;
    }

    if (frame.subdomain !== attachment.subdomain) {
      reject("subdomain does not match tunnel URL");
      return;
    }

    const owner = (await this.ctx.storage.get<OwnerRecord>(OWNER_KEY)) ?? null;
    const nonce = base64ToBytes(attachment.nonce);

    if (frame.type === "claim") {
      if (owner) {
        reject("this name already has an owner; prove ownership or use a different name");
        return;
      }
      if (frame.secret.byteLength !== SECRET_BYTES) {
        reject(`ownership secret must be ${SECRET_BYTES} bytes`);
        return;
      }
      await this.ctx.storage.put<OwnerRecord>(OWNER_KEY, {
        secret: bytesToBase64(frame.secret),
        claimedAt: Date.now(),
      });
      console.log("tunnel name claimed", { subdomain: attachment.subdomain });
    } else {
      if (!owner) {
        reject("this name has no owner yet; claim it before proving ownership");
        return;
      }

      const expected = await hmacSha256(
        base64ToBytes(owner.secret),
        proofMessage(nonce, attachment.subdomain),
      );
      if (!constantTimeEqual(expected, frame.proof)) {
        console.warn("tunnel ownership proof rejected", { subdomain: attachment.subdomain });
        reject("ownership proof rejected");
        return;
      }

      if (frame.type === "rotate") {
        if (frame.newSecret.byteLength !== SECRET_BYTES) {
          reject(`replacement secret must be ${SECRET_BYTES} bytes`);
          return;
        }
        await this.ctx.storage.put<OwnerRecord>(OWNER_KEY, {
          secret: bytesToBase64(frame.newSecret),
          claimedAt: owner.claimedAt,
          rotatedAt: Date.now(),
        });
        console.log("tunnel ownership secret rotated", { subdomain: attachment.subdomain });
      }
    }

    attachment.registered = true;
    ws.serializeAttachment(attachment);
    ws.send(encodeRegisterAck(true, "registered"));
    console.log("tunnel connected", {
      subdomain: attachment.subdomain,
      generation: attachment.generation,
    });
  }

  private async acceptTunnel(request: Request): Promise<Response> {
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

    const generation = ((await this.ctx.storage.get<number>(GENERATION_KEY)) ?? 0) + 1;
    await this.ctx.storage.put(GENERATION_KEY, generation);

    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const owner = await this.ctx.storage.get<OwnerRecord>(OWNER_KEY);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [TUNNEL_TAG]);
    server.serializeAttachment({
      subdomain,
      registered: false,
      nonce: bytesToBase64(nonce),
      generation,
    } satisfies SocketAttachment);

    // Challenge first: the client learns the nonce, and whether to claim the
    // name or prove it already owns it, before sending anything.
    server.send(encodeChallenge(nonce, Boolean(owner)));

    // A socket that never finishes registering must not linger. A timer
    // rather than `waitUntil` so the upgrade response is not held open.
    setTimeout(() => {
      const attachment = server.deserializeAttachment() as SocketAttachment | null;
      if (attachment && !attachment.registered) {
        console.warn("closing a tunnel socket that never registered", { subdomain });
        try {
          server.close(1008, "registration deadline exceeded");
        } catch {
          // Already gone.
        }
      }
    }, this.registrationDeadlineMs());

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

    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return new Response("tunnel is busy", {
        status: 503,
        headers: { "retry-after": "1" },
      });
    }

    const attachment = socket.deserializeAttachment() as SocketAttachment;

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      return new Response("request body too large", { status: 413 });
    }

    // Read the body with the limit applied as we go. Buffering it whole and
    // *then* checking the size meant a chunked request with no
    // content-length was fully materialised before being rejected.
    let body: Uint8Array;
    try {
      body = await readBoundedBody(request, MAX_REQUEST_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return new Response("request body too large", { status: 413 });
      }
      return new Response("could not read the request body", { status: 400 });
    }

    const requestId = this.nextRequestId++;
    const response = new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(new Response("tunnel request timed out", { status: 504 }));
      }, this.requestTimeoutMs());
      this.pending.set(requestId, {
        kind: "headers",
        generation: attachment.generation,
        method: request.method.toUpperCase(),
        resolve,
        timeout,
      });
    });

    // Tell the client to stop when the browser goes away, instead of
    // leaving the local server working on a response nobody will read.
    request.signal?.addEventListener("abort", () => {
      if (!this.pending.has(requestId)) return;
      this.abortRequest(requestId, attachment.generation, "client disconnected");
      trySend(socket, encodeCancel(requestId));
    }, { once: true });

    const url = new URL(request.url);
    try {
      socket.send(encodeHttpRequest({
        type: "httpRequest",
        requestId,
        method: request.method,
        uri: `${url.pathname}${url.search}`,
        headers: sanitizeRequestHeaders(request, url),
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

  private startResponse(
    requestId: bigint,
    status: number,
    headerPairs: HeaderPair[],
    generation: number,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "headers" || pending.generation !== generation) return;

    clearTimeout(pending.timeout);

    const headers = new Headers();
    for (const [name, value] of headerPairs) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.append(name, value);
    }

    // 204/205/304, and any response to HEAD, must have a null body. The
    // previous implementation always constructed a Response with a stream,
    // which the runtime rejects for these statuses — turning a valid 204
    // from the origin into a 502.
    if (BODYLESS_STATUSES.has(status) || pending.method === "HEAD") {
      this.pending.delete(requestId);
      pending.resolve(new Response(null, { status, headers }));
      return;
    }

    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const body: PendingBody = {
      kind: "body",
      generation,
      writer,
      writes: Promise.resolve(),
      queuedBytes: 0,
    };
    body.timeout = this.newBodyTimeout(requestId, body);
    this.pending.set(requestId, body);

    try {
      pending.resolve(new Response(stream.readable, {
        status,
        headers,
        // The tunnel forwards the origin bytes verbatim. Without this,
        // Workers compresses an already-compressed response a second time.
        encodeBody: "manual",
      }));
    } catch (error) {
      if (body.timeout !== undefined) clearTimeout(body.timeout);
      this.pending.delete(requestId);
      void writer.abort(error);
      pending.resolve(new Response("invalid response from tunnel client", { status: 502 }));
    }
  }

  private writeResponseChunk(requestId: bigint, data: Uint8Array, generation: number): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "body" || pending.generation !== generation) return;

    // Enforce the byte budgets before accepting more data.
    if (
      pending.queuedBytes + data.byteLength > MAX_QUEUED_BYTES_PER_REQUEST
      || this.queuedBytesTotal + data.byteLength > MAX_QUEUED_BYTES_TOTAL
    ) {
      console.warn("aborting a tunnel response that exceeded its queue budget", {
        requestId: requestId.toString(),
        queuedBytes: pending.queuedBytes,
        totalQueuedBytes: this.queuedBytesTotal,
      });
      this.abortRequest(requestId, generation, "response exceeded the relay queue budget");
      return;
    }

    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending.timeout = this.newBodyTimeout(requestId, pending);

    // Accounting is per chunk and happens in exactly one place: the chunk is
    // charged here and released once its write settles, whether it resolved
    // or rejected. The terminal paths below deliberately do *not* adjust the
    // counters — doing both would either double-subtract (under-counting the
    // budget) or, on a rejection carrying several chunks, release only one
    // chunk's worth and leak the rest, which would eventually make the
    // tunnel refuse every response.
    pending.queuedBytes += data.byteLength;
    this.queuedBytesTotal += data.byteLength;

    const release = () => {
      pending.queuedBytes = Math.max(0, pending.queuedBytes - data.byteLength);
      this.queuedBytesTotal = Math.max(0, this.queuedBytesTotal - data.byteLength);
    };

    pending.writes = pending.writes
      .then(() => pending.writer.write(data))
      .then(release)
      .catch(() => {
        release();
        if (pending.timeout !== undefined) clearTimeout(pending.timeout);
        if (this.pending.get(requestId) === pending) this.pending.delete(requestId);
      });
  }

  private endResponse(requestId: bigint, generation: number): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.kind !== "body" || pending.generation !== generation) return;
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    // Queued bytes are released by each chunk's own write callback.
    this.ctx.waitUntil(pending.writes.then(() => pending.writer.close()).catch(() => undefined));
  }

  /**
   * Terminate one request as an error.
   *
   * For a response whose headers have already been sent, the body stream is
   * aborted — the browser sees a failed transfer rather than a truncated
   * body presented as a complete one.
   */
  private abortRequest(requestId: bigint, generation: number, reason: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.generation !== generation) return;

    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    this.pending.delete(requestId);

    if (pending.kind === "headers") {
      pending.resolve(new Response(reason, { status: 502 }));
      return;
    }

    // Queued bytes are released by each chunk's own write callback; aborting
    // the writer rejects those writes, so the callbacks still run.
    this.ctx.waitUntil(pending.writer.abort(new Error(reason)).catch(() => undefined));
  }

  /**
   * Fail pending requests. When `generation` is supplied, only requests
   * issued on that connection are affected.
   */
  private async failPending(message: string, generation?: number): Promise<void> {
    const writes: Promise<unknown>[] = [];
    for (const [requestId, pending] of this.pending) {
      if (generation !== undefined && pending.generation !== generation) continue;
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

  private registrationDeadlineMs(): number {
    const value = Number(this.env.REGISTRATION_DEADLINE_MS);
    return Number.isFinite(value) && value > 0 ? value : REGISTRATION_DEADLINE_MS;
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

class BodyTooLargeError extends Error {}

/** Read a request body, failing as soon as it exceeds `limit` bytes. */
async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new BodyTooLargeError("request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Replace caller-controlled forwarding and internal headers with values we
 * actually know.
 *
 * The app builds redirects from `x-forwarded-host`/`-proto`, and the
 * desktop capability token travels in an `x-alex-` header, so neither may
 * be settable by a public caller. `cf-connecting-ip` is set by the edge and
 * is the only client address worth forwarding.
 */
function sanitizeRequestHeaders(request: Request, url: URL): HeaderPair[] {
  const headers: HeaderPair[] = [];

  for (const [name, value] of request.headers.entries()) {
    const lower = name.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
    if (lower.startsWith("x-alex-")) continue;
    headers.push([name, value]);
  }

  headers.push(["x-forwarded-proto", "https"]);
  headers.push(["x-forwarded-host", url.hostname]);

  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.push(["x-forwarded-for", clientIp]);

  return headers;
}

const STRIPPED_REQUEST_HEADERS = new Set([
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-forwarded-port",
  "x-forwarded-server",
  "forwarded",
  "x-real-ip",
]);

function trySend(socket: WebSocket, data: Uint8Array): void {
  try {
    socket.send(data);
  } catch {
    // The socket is gone; the disconnect path handles cleanup.
  }
}

function proofMessage(nonce: Uint8Array, subdomain: string): Uint8Array {
  const name = new TextEncoder().encode(subdomain);
  const message = new Uint8Array(nonce.byteLength + name.byteLength);
  message.set(nonce, 0);
  message.set(name, nonce.byteLength);
  return message;
}

/**
 * Copy into a plain ArrayBuffer.
 *
 * A `Uint8Array` can be backed by a `SharedArrayBuffer`, which WebCrypto's
 * `BufferSource` does not accept, so the bytes are copied rather than cast.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(message));
  return new Uint8Array(signature);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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
