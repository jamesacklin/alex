import { describe, expect, it } from "vitest";
import {
  decodeClientFrame,
  decodeServerFrame,
  encodeHttpRequest,
  encodeHttpResponse,
  encodeRegister,
  encodeRegisterAck,
  encodeResponseChunk,
  encodeResponseEnd,
} from "../src/protocol";

describe("Rust bincode protocol compatibility", () => {
  it("encodes Register with bincode's fixed-int little-endian layout", () => {
    expect(hex(encodeRegister("demo"))).toBe("00000000040000000000000064656d6f");
    expect(decodeClientFrame(encodeRegister("demo"))).toEqual({
      type: "register",
      subdomain: "demo",
    });
  });

  it("round trips server frames", () => {
    expect(decodeServerFrame(encodeRegisterAck(true, "registered"))).toEqual({
      type: "registerAck",
      success: true,
      message: "registered",
    });

    const request = encodeHttpRequest({
      type: "httpRequest",
      requestId: 42n,
      method: "POST",
      uri: "/books?q=alex",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode('{"ok":true}'),
    });
    expect(decodeServerFrame(request)).toEqual({
      type: "httpRequest",
      requestId: 42n,
      method: "POST",
      uri: "/books?q=alex",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode('{"ok":true}'),
    });
  });

  it("round trips client response frames", () => {
    expect(decodeClientFrame(encodeHttpResponse(99n, 200, [["content-type", "text/plain"]])))
      .toEqual({
        type: "httpResponse",
        requestId: 99n,
        status: 200,
        headers: [["content-type", "text/plain"]],
      });
    expect(decodeClientFrame(encodeResponseChunk(99n, new Uint8Array([1, 2, 3]))))
      .toEqual({ type: "responseChunk", requestId: 99n, data: new Uint8Array([1, 2, 3]) });
    expect(decodeClientFrame(encodeResponseEnd(99n)))
      .toEqual({ type: "responseEnd", requestId: 99n });
  });
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
