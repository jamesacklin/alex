import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  decodeServerFrame,
  encodeHttpResponse,
  encodeRegister,
  encodeResponseChunk,
  encodeResponseEnd,
} from "../src/protocol";

describe("relay Worker", () => {
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

  it("proxies an HTTP response through the registered WebSocket", async () => {
    const upgrade = await SELF.fetch(
      "https://relay.alexreader.app/_tunnel/ws?subdomain=test-tunnel",
      { headers: { Upgrade: "websocket" } },
    );
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket;
    expect(ws).not.toBeNull();
    ws!.accept();

    const ackMessage = nextBinaryMessage(ws!);
    ws!.send(encodeRegister("test-tunnel"));
    expect(decodeServerFrame(await ackMessage)).toEqual({
      type: "registerAck",
      success: true,
      message: "registered",
    });

    const requestMessage = nextBinaryMessage(ws!);
    const browserResponsePromise = SELF.fetch(
      "https://test-tunnel.alexreader.app/books?q=recent",
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

    ws!.send(encodeHttpResponse(tunneledRequest.requestId, 201, [
      ["content-type", "text/plain"],
      ["x-relayed", "yes"],
      ["set-cookie", "session=abc; Path=/; Secure; HttpOnly"],
      ["set-cookie", "theme=dark; Path=/; Secure"],
    ]));
    ws!.send(encodeResponseChunk(
      tunneledRequest.requestId,
      new TextEncoder().encode("hello "),
    ));
    ws!.send(encodeResponseChunk(
      tunneledRequest.requestId,
      new TextEncoder().encode("from Alex"),
    ));
    ws!.send(encodeResponseEnd(tunneledRequest.requestId));

    const browserResponse = await browserResponsePromise;
    expect(browserResponse.status).toBe(201);
    expect(browserResponse.headers.get("x-relayed")).toBe("yes");
    expect(browserResponse.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; Secure; HttpOnly",
      "theme=dark; Path=/; Secure",
    ]);
    expect(await browserResponse.text()).toBe("hello from Alex");
    const closed = new Promise<void>((resolve) => {
      ws!.addEventListener("close", () => resolve(), { once: true });
    });
    ws!.close(1000, "done");
    await closed;
  });
});

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
