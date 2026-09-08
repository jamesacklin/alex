import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  decodeServerFrame,
  encodeClaim,
  encodeHttpResponse,
  encodeProve,
  encodeRegister,
  encodeResponseChunk,
  encodeResponseEnd,
  encodeRotate,
  encodeCancel,
  type ServerFrame,
} from "../src/protocol";

/**
 * Each `describe` uses its own subdomain because ownership is persisted per
 * Durable Object and survives for the lifetime of the test worker.
 */

describe("relay Worker — upgrade handling", () => {
  it("requires the tunnel subdomain before upgrading", async () => {
    const response = await SELF.fetch("https://relay.alexreader.app/_tunnel/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(400);
  });

  it("returns 502 when a tunnel is offline", async () => {
    const response = await SELF.fetch("https://offline.alexreader.app/books");
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("tunnel not connected");
  });
});

describe("relay Worker — tunnel ownership (F02)", () => {
  it("rejects a protocol v1 client with an explanation instead of registering it", async () => {
    const { ws, challenge } = await connect("legacy-client");
    expect(challenge.claimed).toBe(false);

    const ack = nextBinaryMessage(ws);
    ws.send(encodeRegister("legacy-client"));
    const decoded = decodeServerFrame(await ack);

    expect(decoded).toMatchObject({ type: "registerAck", success: false });
    if (decoded.type !== "registerAck") throw new Error("expected registerAck");
    expect(decoded.message).toContain(`v${PROTOCOL_VERSION}`);
    close(ws);
  });

  it("lets the owner claim an unowned name and prove it on reconnect", async () => {
    const secret = randomSecret();

    const first = await connect("claimable");
    expect(first.challenge.claimed).toBe(false);
    await register(first.ws, encodeClaim("claimable", secret));
    await closeAndWait(first.ws);

    // Second connection must prove, and the relay now reports the name owned.
    const second = await connect("claimable");
    expect(second.challenge.claimed).toBe(true);
    await register(
      second.ws,
      encodeProve("claimable", await proof(secret, second.challenge.nonce, "claimable")),
    );
    await closeAndWait(second.ws);
  });

  it("refuses to let an unrelated client reclaim an offline name", async () => {
    const ownerSecret = randomSecret();

    const owner = await connect("owned-name");
    await register(owner.ws, encodeClaim("owned-name", ownerSecret));
    await closeAndWait(owner.ws);

    // The takeover attempt the review reproduced: connect to the same public
    // name while the owner is offline.
    const attacker = await connect("owned-name");
    expect(attacker.challenge.claimed).toBe(true);

    const claimAck = nextBinaryMessage(attacker.ws);
    attacker.ws.send(encodeClaim("owned-name", randomSecret()));
    expect(decodeServerFrame(await claimAck)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(attacker.ws);

    // A guessed secret does not work either.
    const guesser = await connect("owned-name");
    const guessAck = nextBinaryMessage(guesser.ws);
    guesser.ws.send(
      encodeProve("owned-name", await proof(randomSecret(), guesser.challenge.nonce, "owned-name")),
    );
    expect(decodeServerFrame(await guessAck)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(guesser.ws);

    // And an unregistered socket serves no traffic, so no browser request —
    // and no cookie — can reach it.
    const browser = await SELF.fetch("https://owned-name.alexreader.app/library", {
      headers: { cookie: "authjs.session-token=super-secret" },
    });
    expect(browser.status).toBe(502);
  });

  it("rejects a captured proof replayed on a later connection", async () => {
    const secret = randomSecret();

    const first = await connect("replay-target");
    await register(first.ws, encodeClaim("replay-target", secret));
    await closeAndWait(first.ws);

    const second = await connect("replay-target");
    const capturedProof = await proof(secret, second.challenge.nonce, "replay-target");
    await register(second.ws, encodeProve("replay-target", capturedProof));
    await closeAndWait(second.ws);

    // Same proof bytes, new connection: the nonce has changed, so it fails.
    const third = await connect("replay-target");
    expect(bytesToHex(third.challenge.nonce)).not.toBe(bytesToHex(second.challenge.nonce));
    const ack = nextBinaryMessage(third.ws);
    third.ws.send(encodeProve("replay-target", capturedProof));
    expect(decodeServerFrame(await ack)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(third.ws);
  });

  it("rejects a proof computed for a different name", async () => {
    const secret = randomSecret();
    const owner = await connect("bound-name");
    await register(owner.ws, encodeClaim("bound-name", secret));
    await closeAndWait(owner.ws);

    const attempt = await connect("bound-name");
    const ack = nextBinaryMessage(attempt.ws);
    // A valid proof, but computed over a different subdomain.
    attempt.ws.send(
      encodeProve("bound-name", await proof(secret, attempt.challenge.nonce, "other-name")),
    );
    expect(decodeServerFrame(await ack)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(attempt.ws);
  });

  it("supports rotating the ownership secret and invalidates the old one", async () => {
    const original = randomSecret();
    const replacement = randomSecret();

    const first = await connect("rotating");
    await register(first.ws, encodeClaim("rotating", original));
    await closeAndWait(first.ws);

    const rotate = await connect("rotating");
    await register(
      rotate.ws,
      encodeRotate(
        "rotating",
        await proof(original, rotate.challenge.nonce, "rotating"),
        replacement,
      ),
    );
    await closeAndWait(rotate.ws);

    // The old secret no longer proves anything.
    const stale = await connect("rotating");
    const staleAck = nextBinaryMessage(stale.ws);
    stale.ws.send(
      encodeProve("rotating", await proof(original, stale.challenge.nonce, "rotating")),
    );
    expect(decodeServerFrame(await staleAck)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(stale.ws);

    // The replacement does.
    const fresh = await connect("rotating");
    await register(
      fresh.ws,
      encodeProve("rotating", await proof(replacement, fresh.challenge.nonce, "rotating")),
    );
    await closeAndWait(fresh.ws);
  });

  it("rejects an ownership secret of the wrong length", async () => {
    const attempt = await connect("short-secret");
    const ack = nextBinaryMessage(attempt.ws);
    attempt.ws.send(encodeClaim("short-secret", new Uint8Array(8)));
    expect(decodeServerFrame(await ack)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(attempt.ws);
  });

  it("rejects a registration whose subdomain does not match the URL", async () => {
    const attempt = await connect("url-name");
    const ack = nextBinaryMessage(attempt.ws);
    attempt.ws.send(encodeClaim("some-other-name", randomSecret()));
    expect(decodeServerFrame(await ack)).toMatchObject({
      type: "registerAck",
      success: false,
    });
    close(attempt.ws);
  });

  it("refuses a second live socket for the same name", async () => {
    const secret = randomSecret();
    const owner = await connect("single-socket");
    await register(owner.ws, encodeClaim("single-socket", secret));

    const second = await SELF.fetch(
      "https://relay.alexreader.app/_tunnel/ws?subdomain=single-socket",
      { headers: { Upgrade: "websocket" } },
    );
    expect(second.status).toBe(409);

    await closeAndWait(owner.ws);
  });
});

describe("relay Worker — HTTP semantics", () => {
  it("proxies a response, preserving repeated Set-Cookie headers", async () => {
    const tunnel = await openTunnel("proxy-basic");

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const browserResponsePromise = SELF.fetch(
      "https://proxy-basic.alexreader.app/books?q=recent",
      {
        method: "POST",
        headers: { "content-type": "text/plain", "x-test": "yes" },
        body: "request body",
      },
    );

    const tunneledRequest = decodeServerFrame(await requestMessage);
    expect(tunneledRequest).toMatchObject({
      type: "httpRequest",
      method: "POST",
      uri: "/books?q=recent",
      body: new TextEncoder().encode("request body"),
    });
    if (tunneledRequest.type !== "httpRequest") throw new Error("expected HTTP request");

    tunnel.ws.send(encodeHttpResponse(tunneledRequest.requestId, 201, [
      ["content-type", "text/plain"],
      ["x-relayed", "yes"],
      ["set-cookie", "session=abc; Path=/; Secure; HttpOnly"],
      ["set-cookie", "theme=dark; Path=/; Secure"],
    ]));
    tunnel.ws.send(encodeResponseChunk(
      tunneledRequest.requestId,
      new TextEncoder().encode("hello "),
    ));
    tunnel.ws.send(encodeResponseChunk(
      tunneledRequest.requestId,
      new TextEncoder().encode("from Alex"),
    ));
    tunnel.ws.send(encodeResponseEnd(tunneledRequest.requestId));

    const browserResponse = await browserResponsePromise;
    expect(browserResponse.status).toBe(201);
    expect(browserResponse.headers.get("x-relayed")).toBe("yes");
    expect(browserResponse.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; Secure; HttpOnly",
      "theme=dark; Path=/; Secure",
    ]);
    expect(await browserResponse.text()).toBe("hello from Alex");

    await closeAndWait(tunnel.ws);
  });

  it("replaces caller-supplied forwarding and internal headers", async () => {
    const tunnel = await openTunnel("header-sanitizing");

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const responsePromise = SELF.fetch("https://header-sanitizing.alexreader.app/library", {
      headers: {
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "http",
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.1",
        forwarded: "for=10.0.0.1;host=evil.example.com",
        // The desktop capability token must never be settable from outside.
        "x-alex-desktop-auth": "stolen-token",
        cookie: "authjs.session-token=abc",
      },
    });

    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");

    const headers = new Map(request.headers.map(([name, value]) => [name.toLowerCase(), value]));
    expect(headers.get("x-forwarded-host")).toBe("header-sanitizing.alexreader.app");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-alex-desktop-auth")).toBeUndefined();
    expect(headers.get("forwarded")).toBeUndefined();
    expect(headers.get("x-real-ip")).toBeUndefined();
    // Ordinary headers still pass through.
    expect(headers.get("cookie")).toBe("authjs.session-token=abc");

    // Only one value each, so the app cannot see the attacker's alongside ours.
    expect(request.headers.filter(([name]) => name.toLowerCase() === "x-forwarded-host")).toHaveLength(1);
    expect(request.headers.filter(([name]) => name.toLowerCase() === "x-forwarded-proto")).toHaveLength(1);

    tunnel.ws.send(encodeHttpResponse(request.requestId, 204, []));
    await responsePromise;
    await closeAndWait(tunnel.ws);
  });

  it.each([204, 205, 304])("passes a bodyless %i through instead of turning it into a 502", async (status) => {
    const tunnel = await openTunnel(`bodyless-${status}`);

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const responsePromise = SELF.fetch(`https://bodyless-${status}.alexreader.app/api/thing`);

    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");

    tunnel.ws.send(encodeHttpResponse(request.requestId, status, [["x-marker", "yes"]]));

    const response = await responsePromise;
    expect(response.status).toBe(status);
    expect(response.headers.get("x-marker")).toBe("yes");
    expect(response.body).toBeNull();

    await closeAndWait(tunnel.ws);
  });

  it("returns a bodyless response for HEAD", async () => {
    const tunnel = await openTunnel("head-request");

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const responsePromise = SELF.fetch("https://head-request.alexreader.app/api/books", {
      method: "HEAD",
    });

    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");
    expect(request.method).toBe("HEAD");

    tunnel.ws.send(encodeHttpResponse(request.requestId, 200, [["content-length", "1234"]]));

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1234");
    expect(response.body).toBeNull();

    await closeAndWait(tunnel.ws);
  });

  it("delivers a small streaming chunk before the response ends", async () => {
    const tunnel = await openTunnel("sse-stream");

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const responsePromise = SELF.fetch("https://sse-stream.alexreader.app/api/library/events", {
      headers: { accept: "text/event-stream" },
    });

    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");

    tunnel.ws.send(encodeHttpResponse(request.requestId, 200, [
      ["content-type", "text/event-stream"],
      ["cache-control", "no-cache"],
    ]));
    tunnel.ws.send(encodeResponseChunk(
      request.requestId,
      new TextEncoder().encode(": keepalive\n\n"),
    ));

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    // The first event must arrive without waiting for responseEnd.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(": keepalive\n\n");

    tunnel.ws.send(encodeResponseEnd(request.requestId));
    await reader.cancel();
    await closeAndWait(tunnel.ws);
  });

  it("rejects an oversized chunked request without buffering it whole", async () => {
    const tunnel = await openTunnel("oversized-body");

    // A chunked request declares no content-length, so the size can only be
    // discovered while reading it.
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        const megabyte = new Uint8Array(1024 * 1024);
        for (let index = 0; index < 12; index++) controller.enqueue(megabyte);
        controller.close();
      },
    });

    const response = await SELF.fetch("https://oversized-body.alexreader.app/api/upload", {
      method: "POST",
      body: oversized,
      // @ts-expect-error duplex is required for a streaming request body
      duplex: "half",
    });

    expect(response.status).toBe(413);
    await closeAndWait(tunnel.ws);
  });

  it("rejects an oversized declared body up front", async () => {
    const tunnel = await openTunnel("oversized-declared");

    const response = await SELF.fetch("https://oversized-declared.alexreader.app/api/upload", {
      method: "POST",
      headers: { "content-length": String(11 * 1024 * 1024) },
      body: new Uint8Array(16),
    });

    expect(response.status).toBe(413);
    await closeAndWait(tunnel.ws);
  });

  it("aborts the response body when the client cancels the transfer", async () => {
    const tunnel = await openTunnel("cancelled-transfer");

    const requestMessage = nextBinaryMessage(tunnel.ws);
    const responsePromise = SELF.fetch("https://cancelled-transfer.alexreader.app/api/books/1/file");

    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");

    tunnel.ws.send(encodeHttpResponse(request.requestId, 200, [
      ["content-type", "application/pdf"],
      ["content-length", "1000000"],
    ]));
    tunnel.ws.send(encodeResponseChunk(request.requestId, new Uint8Array(1024)));

    const response = await responsePromise;
    const reader = response.body!.getReader();
    await reader.read();

    // The tunnel client reports the upstream transfer failed after headers.
    tunnel.ws.send(encodeCancel(request.requestId));

    // The body must terminate as an error, never as a clean short read that
    // would look like a complete file.
    await expect(readToEnd(reader)).rejects.toBeTruthy();

    await closeAndWait(tunnel.ws);
  });

  it("ignores response frames for a request from a previous connection", async () => {
    const secret = randomSecret();
    const first = await connect("generation-isolation");
    await register(first.ws, encodeClaim("generation-isolation", secret));

    const requestMessage = nextBinaryMessage(first.ws);
    const responsePromise = SELF.fetch("https://generation-isolation.alexreader.app/one");
    const request = decodeServerFrame(await requestMessage);
    if (request.type !== "httpRequest") throw new Error("expected HTTP request");

    // The owner drops the connection mid-request; the pending request fails.
    await closeAndWait(first.ws);
    const failed = await responsePromise;
    expect(failed.status).toBe(502);

    // A fresh connection must not be able to answer the dead request.
    const second = await connect("generation-isolation");
    await register(
      second.ws,
      encodeProve(
        "generation-isolation",
        await proof(secret, second.challenge.nonce, "generation-isolation"),
      ),
    );
    second.ws.send(encodeHttpResponse(request.requestId, 200, [["x-late", "yes"]]));
    second.ws.send(encodeResponseEnd(request.requestId));

    // Its own request still works, which shows the tunnel is healthy rather
    // than wedged by the stale frames.
    const liveMessage = nextBinaryMessage(second.ws);
    const livePromise = SELF.fetch("https://generation-isolation.alexreader.app/two");
    const liveRequest = decodeServerFrame(await liveMessage);
    if (liveRequest.type !== "httpRequest") throw new Error("expected HTTP request");
    expect(liveRequest.requestId).not.toBe(request.requestId);
    second.ws.send(encodeHttpResponse(liveRequest.requestId, 200, [["x-live", "yes"]]));
    second.ws.send(encodeResponseEnd(liveRequest.requestId));

    const live = await livePromise;
    expect(live.headers.get("x-live")).toBe("yes");

    await closeAndWait(second.ws);
  });
});

// --- helpers ---------------------------------------------------------------

interface Connection {
  ws: WebSocket;
  challenge: Extract<ServerFrame, { type: "challenge" }>;
}

async function connect(subdomain: string): Promise<Connection> {
  const upgrade = await SELF.fetch(
    `https://relay.alexreader.app/_tunnel/ws?subdomain=${subdomain}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(upgrade.status).toBe(101);
  const ws = upgrade.webSocket;
  expect(ws).not.toBeNull();

  const challengeMessage = nextBinaryMessage(ws!);
  ws!.accept();
  const challenge = decodeServerFrame(await challengeMessage);
  if (challenge.type !== "challenge") {
    throw new Error(`expected a challenge frame, got ${challenge.type}`);
  }
  expect(challenge.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(challenge.nonce.byteLength).toBe(32);

  return { ws: ws!, challenge };
}

async function register(ws: WebSocket, frame: Uint8Array): Promise<void> {
  const ack = nextBinaryMessage(ws);
  ws.send(frame);
  const decoded = decodeServerFrame(await ack);
  expect(decoded).toEqual({ type: "registerAck", success: true, message: "registered" });
}

/** Claim a fresh name and return the registered socket. */
async function openTunnel(subdomain: string): Promise<Connection> {
  const connection = await connect(subdomain);
  await register(connection.ws, encodeClaim(subdomain, randomSecret()));
  return connection;
}

function close(ws: WebSocket): void {
  try {
    ws.close(1000, "done");
  } catch {
    // Already closed.
  }
}

async function closeAndWait(ws: WebSocket): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
    // The relay echoes the close; guard against a socket already gone.
    setTimeout(resolve, 250);
  });
  close(ws);
  await closed;
}

function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function proof(
  secret: Uint8Array,
  nonce: Uint8Array,
  subdomain: string,
): Promise<Uint8Array> {
  const name = new TextEncoder().encode(subdomain);
  const message = new Uint8Array(nonce.byteLength + name.byteLength);
  message.set(nonce, 0);
  message.set(name, nonce.byteLength);

  const keyBuffer = new ArrayBuffer(secret.byteLength);
  new Uint8Array(keyBuffer).set(secret);
  const messageBuffer = new ArrayBuffer(message.byteLength);
  new Uint8Array(messageBuffer).set(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, messageBuffer));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readToEnd(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

function nextBinaryMessage(ws: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        resolve(event.data);
      } else if (ArrayBuffer.isView(event.data)) {
        resolve(event.data.buffer.slice(
          event.data.byteOffset,
          event.data.byteOffset + event.data.byteLength,
        ) as ArrayBuffer);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then(resolve, reject);
      } else {
        reject(new Error("expected a binary WebSocket message"));
      }
    }, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")), { once: true });
  });
}
