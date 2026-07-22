const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const FRAME = {
  register: 0,
  registerAck: 1,
  httpRequest: 2,
  httpResponse: 3,
  responseChunk: 4,
  responseEnd: 5,
  ping: 6,
  pong: 7,
} as const;

export type HeaderPair = [string, string];

export type ClientFrame =
  | { type: "register"; subdomain: string }
  | { type: "httpResponse"; requestId: bigint; status: number; headers: HeaderPair[] }
  | { type: "responseChunk"; requestId: bigint; data: Uint8Array }
  | { type: "responseEnd"; requestId: bigint }
  | { type: "pong" };

export type ServerFrame =
  | { type: "registerAck"; success: boolean; message: string }
  | {
      type: "httpRequest";
      requestId: bigint;
      method: string;
      uri: string;
      headers: HeaderPair[];
      body: Uint8Array;
    }
  | { type: "ping" };

class BincodeWriter {
  private bytes = new Uint8Array(256);
  private offset = 0;

  u8(value: number): void {
    this.ensure(1);
    this.bytes[this.offset++] = value & 0xff;
  }

  u16(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
  }

  u32(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
    this.u8(value >>> 16);
    this.u8(value >>> 24);
  }

  u64(value: bigint): void {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError("u64 value is out of range");
    }
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.u8(Number((value >> shift) & 0xffn));
    }
  }

  string(value: string): void {
    this.byteVector(textEncoder.encode(value));
  }

  headers(headers: HeaderPair[]): void {
    this.u64(BigInt(headers.length));
    for (const [name, value] of headers) {
      this.string(name);
      this.string(value);
    }
  }

  byteVector(value: Uint8Array): void {
    this.u64(BigInt(value.byteLength));
    this.ensure(value.byteLength);
    this.bytes.set(value, this.offset);
    this.offset += value.byteLength;
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }

  private ensure(additionalBytes: number): void {
    const required = this.offset + additionalBytes;
    if (required <= this.bytes.byteLength) return;

    let capacity = this.bytes.byteLength;
    while (capacity < required) capacity = Math.max(capacity * 2, required);
    const expanded = new Uint8Array(capacity);
    expanded.set(this.bytes);
    this.bytes = expanded;
  }
}

class BincodeReader {
  private offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;

  constructor(input: ArrayBuffer | ArrayBufferView) {
    this.bytes = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  u8(): number {
    this.require(1);
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    this.require(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  string(): string {
    return textDecoder.decode(this.byteVector());
  }

  headers(): HeaderPair[] {
    const count = this.safeLength(this.u64());
    const headers: HeaderPair[] = [];
    for (let index = 0; index < count; index++) {
      headers.push([this.string(), this.string()]);
    }
    return headers;
  }

  byteVector(): Uint8Array {
    const length = this.safeLength(this.u64());
    this.require(length);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  done(): void {
    if (this.offset !== this.bytes.byteLength) {
      throw new Error("bincode frame contains trailing bytes");
    }
  }

  private safeLength(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("bincode collection is too large");
    }
    return Number(value);
  }

  private require(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      throw new Error("unexpected end of bincode frame");
    }
  }
}

function encodeFrame(variant: number, write: (writer: BincodeWriter) => void): Uint8Array {
  const writer = new BincodeWriter();
  writer.u32(variant);
  write(writer);
  return writer.finish();
}

export function decodeClientFrame(input: ArrayBuffer | ArrayBufferView): ClientFrame {
  const reader = new BincodeReader(input);
  const variant = reader.u32();
  let frame: ClientFrame;

  switch (variant) {
    case FRAME.register:
      frame = { type: "register", subdomain: reader.string() };
      break;
    case FRAME.httpResponse:
      frame = {
        type: "httpResponse",
        requestId: reader.u64(),
        status: reader.u16(),
        headers: reader.headers(),
      };
      break;
    case FRAME.responseChunk:
      frame = { type: "responseChunk", requestId: reader.u64(), data: reader.byteVector() };
      break;
    case FRAME.responseEnd:
      frame = { type: "responseEnd", requestId: reader.u64() };
      break;
    case FRAME.pong:
      frame = { type: "pong" };
      break;
    default:
      throw new Error(`unexpected client frame variant ${variant}`);
  }

  reader.done();
  return frame;
}

export function decodeServerFrame(input: ArrayBuffer | ArrayBufferView): ServerFrame {
  const reader = new BincodeReader(input);
  const variant = reader.u32();
  let frame: ServerFrame;

  switch (variant) {
    case FRAME.registerAck:
      frame = { type: "registerAck", success: reader.u8() !== 0, message: reader.string() };
      break;
    case FRAME.httpRequest:
      frame = {
        type: "httpRequest",
        requestId: reader.u64(),
        method: reader.string(),
        uri: reader.string(),
        headers: reader.headers(),
        body: reader.byteVector(),
      };
      break;
    case FRAME.ping:
      frame = { type: "ping" };
      break;
    default:
      throw new Error(`unexpected server frame variant ${variant}`);
  }

  reader.done();
  return frame;
}

export function encodeRegister(subdomain: string): Uint8Array {
  return encodeFrame(FRAME.register, (writer) => writer.string(subdomain));
}

export function encodeRegisterAck(success: boolean, message: string): Uint8Array {
  return encodeFrame(FRAME.registerAck, (writer) => {
    writer.u8(success ? 1 : 0);
    writer.string(message);
  });
}

export function encodeHttpRequest(frame: Extract<ServerFrame, { type: "httpRequest" }>): Uint8Array {
  return encodeFrame(FRAME.httpRequest, (writer) => {
    writer.u64(frame.requestId);
    writer.string(frame.method);
    writer.string(frame.uri);
    writer.headers(frame.headers);
    writer.byteVector(frame.body);
  });
}

export function encodeHttpResponse(
  requestId: bigint,
  status: number,
  headers: HeaderPair[],
): Uint8Array {
  return encodeFrame(FRAME.httpResponse, (writer) => {
    writer.u64(requestId);
    writer.u16(status);
    writer.headers(headers);
  });
}

export function encodeResponseChunk(requestId: bigint, data: Uint8Array): Uint8Array {
  return encodeFrame(FRAME.responseChunk, (writer) => {
    writer.u64(requestId);
    writer.byteVector(data);
  });
}

export function encodeResponseEnd(requestId: bigint): Uint8Array {
  return encodeFrame(FRAME.responseEnd, (writer) => writer.u64(requestId));
}
