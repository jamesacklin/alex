import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import {
  contentRangeValue,
  parseRangeHeader,
  resolveRange,
  unsatisfiableContentRange,
} from "./range";

export interface BookFileRecord {
  filePath: string;
  fileType: string;
  source?: string | null;
}

interface ServeBookFileOptions {
  cacheControl?: string;
  contentTypeOverride?: string;
  filenameOverride?: string;
}

interface SourceDriverContext {
  book: BookFileRecord;
  req: Request;
  options: ServeBookFileOptions;
}

type SourceValidationResult =
  | { ok: true }
  | { ok: false; error: string; status?: number; details?: string };

interface SourceDriver {
  validateConfig?: (ctx: SourceDriverContext) => SourceValidationResult;
  stream: (ctx: SourceDriverContext) => Promise<NextResponse> | NextResponse;
}

const localDriver: SourceDriver = {
  stream: ({ book, req, options }) => streamFromDisk(book, req, options),
};

const s3Driver: SourceDriver = {
  validateConfig: () => {
    if (!process.env.S3_BUCKET) {
      return {
        ok: false,
        status: 500,
        error: "S3 source is not configured on server",
        details: "Missing S3_BUCKET",
      };
    }
    if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
      return {
        ok: false,
        status: 500,
        error: "S3 source credentials are missing on server",
        details: "Missing S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY",
      };
    }
    return { ok: true };
  },
  stream: ({ book, req, options }) => streamFromS3(book, req, options),
};

const SOURCE_HANDLERS: Record<string, SourceDriver> = {
  local: localDriver,
  s3: s3Driver,
};

export async function serveBookFile(
  book: BookFileRecord,
  req: Request,
  options: ServeBookFileOptions = {}
): Promise<NextResponse> {
  const source = normalizeSource(book.source);
  const handler = SOURCE_HANDLERS[source];

  if (!handler) {
    return NextResponse.json(
      { error: `Unsupported book source: ${source}` },
      { status: 501 }
    );
  }

  const context: SourceDriverContext = { book, req, options };
  const validation = handler.validateConfig?.(context) ?? { ok: true };
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, details: validation.details },
      { status: validation.status ?? 500 }
    );
  }

  return await handler.stream(context);
}

function normalizeSource(source: string | null | undefined) {
  if (!source) return "local";
  return source.toLowerCase();
}

function defaultContentType(fileType: string) {
  return fileType === "epub" ? "application/epub+zip" : "application/pdf";
}

function defaultFilename(fileType: string) {
  return fileType === "epub" ? "book.epub" : "book.pdf";
}

function buildResponseHeaders(
  book: BookFileRecord,
  contentLength: number,
  options: ServeBookFileOptions
) {
  const headers: Record<string, string> = {
    "Content-Type": options.contentTypeOverride || defaultContentType(book.fileType),
    "Content-Disposition": `inline; filename="${options.filenameOverride || defaultFilename(book.fileType)}"`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
  };

  if (options.cacheControl) {
    headers["Cache-Control"] = options.cacheControl;
  }

  return headers;
}

function streamFromDisk(
  book: BookFileRecord,
  req: Request,
  options: ServeBookFileOptions
): NextResponse {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(book.filePath);
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const fileSize = stat.size;
  const resolved = resolveRange(parseRangeHeader(req.headers.get("range")), fileSize);

  if (resolved.kind === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": unsatisfiableContentRange(fileSize) },
    });
  }

  const headers = buildResponseHeaders(book, resolved.length, options);

  // An empty file has no bytes to stream, and `createReadStream` must not be
  // asked for a range ending at -1.
  if (resolved.length === 0) {
    return new NextResponse(null, { status: 200, headers });
  }

  const stream = fs.createReadStream(book.filePath, {
    start: resolved.start,
    end: resolved.end,
  });
  const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

  if (resolved.kind === "partial") {
    headers["Content-Range"] = contentRangeValue(resolved, fileSize);
  }

  // Stop reading the file when the client goes away.
  req.signal?.addEventListener("abort", () => stream.destroy(), { once: true });

  return new NextResponse(webStream, {
    status: resolved.kind === "partial" ? 206 : 200,
    headers,
  });
}

function watcherBinaryName() {
  return process.platform === "win32" ? "watcher-rs.exe" : "watcher-rs";
}

function resolveWatcherBinaryPath() {
  const binaryName = watcherBinaryName();
  const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesPath = processWithResourcesPath.resourcesPath;
  const candidates = [
    process.env.WATCHER_RS_BIN,
    path.join(process.cwd(), "watcher-rs", "target", "release", binaryName),
    path.join(process.cwd(), "watcher-rs", "target", "debug", binaryName),
    path.join(process.cwd(), "watcher-rs", "dist", binaryName),
    resourcesPath ? path.join(resourcesPath, "watcher-rs", binaryName) : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return binaryName;
}

/**
 * The child as we use it: spawned with piped stdout and stderr, so both are
 * non-null. `ChildProcessWithoutNullStreams` also asserts a non-null stdin,
 * which is wrong here — stdin is "ignore".
 */
type StreamChild = ChildProcess & {
  stdout: NonNullable<ChildProcess["stdout"]>;
  stderr: NonNullable<ChildProcess["stderr"]>;
};

/** Metadata the Rust helper emits before the body. */
interface StreamHeader {
  protocol?: number;
  status?: number;
  error?: string;
  content_type?: string;
  /** Size of the whole object — the Content-Range denominator. */
  object_size?: number;
  /** Bytes that follow the header. */
  content_length?: number;
  range_start?: number;
  range_end?: number;
}

/** Cap on the JSON header we are willing to buffer before giving up. */
const MAX_HEADER_BYTES = 64 * 1024;
/** How long to wait for the header (not for the whole transfer). */
const HEADER_TIMEOUT_MS = 30_000;
/** How long a transfer may stall with no bytes at all. */
const BODY_IDLE_TIMEOUT_MS = 60_000;
/** Cap on captured stderr, which is only used for diagnostics. */
const MAX_STDERR_BYTES = 16 * 1024;
/**
 * Chunks buffered ahead of the consumer before the child's stdout is paused.
 *
 * This is the memory budget for one transfer: at most this many pipe reads
 * (64 KiB each on Linux) are held, regardless of how large the book is.
 */
const MAX_BUFFERED_CHUNKS = 8;

/**
 * Serve an S3-backed book by streaming it (F07).
 *
 * The previous implementation buffered every chunk the child emitted,
 * concatenated them, copied the result again and wrapped it in a Blob before
 * responding — so memory scaled with book size times concurrent downloads,
 * and the first byte reached the browser only after the last one arrived.
 *
 * Worse, once a header had been parsed it ignored a non-zero child exit and
 * set Content-Length to however many bytes had actually turned up: a
 * 1000-byte response that died after five bytes was served as HTTP 200 with
 * Content-Length 5. Here the declared length comes from the object's own
 * metadata, and a short or failed transfer errors the body instead of
 * completing it.
 */
async function streamFromS3(
  book: BookFileRecord,
  req: Request,
  options: ServeBookFileOptions
): Promise<NextResponse> {
  const binaryPath = resolveWatcherBinaryPath();
  const nodeEnv =
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "test"
      ? process.env.NODE_ENV
      : "production";
  const watcherEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: nodeEnv,
  };

  const args = ["s3-stream", "--key", book.filePath];
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    args.push("--range", rangeHeader);
  }

  let child: StreamChild;
  try {
    const spawned = spawn(binaryPath, args, {
      env: watcherEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!spawned.stdout || !spawned.stderr) {
      throw new Error("child process was spawned without stdout/stderr pipes");
    }
    child = spawned as StreamChild;
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to spawn S3 stream", details: (error as Error).message },
      { status: 500 }
    );
  }

  // Start collecting before anything is awaited. Attaching listeners after
  // the header has been read would drop stdout — or an exit — that arrived
  // in between, which is exactly the sort of handoff race that produces a
  // response that hangs forever.
  const pump = createChildPump(child);

  const kill = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };

  // Stop the transfer when the browser cancels, rather than continuing to
  // pull the object out of S3 for nobody.
  const onAbort = () => {
    pump.abort(new Error("client disconnected"));
    kill();
  };
  req.signal?.addEventListener("abort", onAbort, { once: true });
  const releaseAbort = () => req.signal?.removeEventListener("abort", onAbort);

  let header: StreamHeader;
  try {
    header = await readStreamHeader(pump);
  } catch (error) {
    kill();
    releaseAbort();
    return headerFailureResponse(error, pump.stderr(), pump.exitCode());
  }

  if (header.error || (header.status !== undefined && header.status >= 400 && header.status !== 416)) {
    kill();
    releaseAbort();
    const status = header.status !== undefined && header.status >= 400 ? header.status : 502;
    return NextResponse.json(
      {
        error: status === 404 ? "Book file not found in bucket" : "S3 stream failed",
        details: header.error || pump.stderr().trim() || undefined,
      },
      { status }
    );
  }

  const objectSize = Number(header.object_size ?? 0);
  const declaredLength = Number(header.content_length ?? 0);
  const status = header.status ?? 200;

  if (status === 416) {
    kill();
    releaseAbort();
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": unsatisfiableContentRange(objectSize) },
    });
  }

  const headers = buildResponseHeaders(book, declaredLength, options);
  if (!options.contentTypeOverride && header.content_type) {
    headers["Content-Type"] = header.content_type;
  }
  if (status === 206 && header.range_start !== undefined && header.range_end !== undefined) {
    // The denominator is the size of the whole object, not the length of the
    // slice being returned.
    headers["Content-Range"] = `bytes ${header.range_start}-${header.range_end}/${objectSize}`;
  }

  if (declaredLength === 0) {
    kill();
    releaseAbort();
    return new NextResponse(null, { status, headers });
  }

  const body = buildBodyStream(pump, declaredLength, () => {
    releaseAbort();
    kill();
  });

  return new NextResponse(body, { status, headers });
}

function headerFailureResponse(
  error: unknown,
  stderr: string,
  exitCode: number | null
): NextResponse {
  if (error instanceof HeaderParseError) {
    return NextResponse.json(
      { error: "Failed to parse S3 stream header", details: error.line },
      { status: 500 }
    );
  }
  if (error instanceof HeaderTimeoutError) {
    return NextResponse.json({ error: "S3 stream timeout" }, { status: 504 });
  }
  if (error instanceof SpawnFailedError) {
    return NextResponse.json(
      { error: "Failed to spawn S3 stream", details: error.detail },
      { status: 500 }
    );
  }
  return NextResponse.json(
    {
      error: "S3 stream failed before response header",
      exitCode,
      details: stderr.trim() || undefined,
    },
    { status: 502 }
  );
}

class HeaderParseError extends Error {
  constructor(readonly line: string) {
    super("failed to parse the S3 stream header");
  }
}
class HeaderTimeoutError extends Error {}
class SpawnFailedError extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}
class HeaderMissingError extends Error {}

interface ChildPump {
  /** Take the next buffered chunk, or undefined when none is queued. */
  shift(): Buffer | undefined;
  /** Put bytes back at the front (used for body bytes read with the header). */
  unshift(chunk: Buffer): void;
  /** Resolve when more data, an exit or an error arrives. */
  wait(): Promise<void>;
  finished(): boolean;
  exitCode(): number | null;
  failure(): Error | null;
  stderr(): string;
  /** Mark the pump as failed, waking any reader. */
  abort(error: Error): void;
}

/**
 * Buffer a child's stdout with backpressure, and record how it ended.
 *
 * Listeners are attached once, immediately after spawn, so nothing is lost
 * between reading the header and streaming the body.
 */
function createChildPump(child: StreamChild): ChildPump {
  const queue: Buffer[] = [];
  const waiters: (() => void)[] = [];
  let exited = false;
  let exitCode: number | null = null;
  let failure: Error | null = null;
  let stderr = "";
  let paused = false;

  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  const applyBackpressure = () => {
    if (!paused && queue.length >= MAX_BUFFERED_CHUNKS) {
      paused = true;
      child.stdout.pause();
    } else if (paused && queue.length < MAX_BUFFERED_CHUNKS) {
      paused = false;
      child.stdout.resume();
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    queue.push(chunk);
    applyBackpressure();
    wake();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_BYTES) {
      stderr += chunk.toString("utf8");
    }
  });

  child.once("close", (code) => {
    exited = true;
    exitCode = code;
    wake();
  });

  child.once("error", (error: Error) => {
    exited = true;
    failure = error;
    wake();
  });

  return {
    shift() {
      const chunk = queue.shift();
      applyBackpressure();
      return chunk;
    },
    unshift(chunk: Buffer) {
      queue.unshift(chunk);
    },
    wait() {
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    finished: () => exited && queue.length === 0,
    exitCode: () => exitCode,
    failure: () => failure,
    stderr: () => stderr,
    abort(error: Error) {
      exited = true;
      failure = error;
      wake();
    },
  };
}

/**
 * Read the newline-terminated JSON header, returning any body bytes that
 * arrived in the same chunk to the pump.
 */
async function readStreamHeader(pump: ChildPump): Promise<StreamHeader> {
  let buffer = Buffer.alloc(0);
  const deadline = Date.now() + HEADER_TIMEOUT_MS;

  for (;;) {
    let chunk = pump.shift();
    while (chunk !== undefined) {
      buffer = Buffer.concat([buffer, chunk]);
      const newlineIndex = buffer.indexOf(0x0a);

      if (newlineIndex !== -1) {
        const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
        const leftover = Buffer.from(buffer.subarray(newlineIndex + 1));
        if (leftover.byteLength > 0) pump.unshift(leftover);

        try {
          return JSON.parse(line) as StreamHeader;
        } catch {
          throw new HeaderParseError(line);
        }
      }

      if (buffer.byteLength > MAX_HEADER_BYTES) {
        throw new HeaderParseError(buffer.subarray(0, 200).toString("utf8"));
      }

      chunk = pump.shift();
    }

    const failure = pump.failure();
    if (failure) throw new SpawnFailedError(failure.message);
    if (pump.finished()) {
      if (buffer.byteLength > 0) {
        throw new HeaderParseError(buffer.subarray(0, 200).toString("utf8"));
      }
      throw new HeaderMissingError();
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HeaderTimeoutError();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), remaining);
    });
    const outcome = await Promise.race([pump.wait().then(() => "data" as const), timeout]);
    clearTimeout(timer);
    if (outcome === "timeout") throw new HeaderTimeoutError();
  }
}

/**
 * Forward the child's remaining stdout as the response body.
 *
 * The stream errors — rather than ending cleanly — when the child exits
 * non-zero, delivers fewer bytes than the header declared, or delivers more,
 * so a partial or corrupted transfer can never be presented to the client as
 * a complete file.
 */
function buildBodyStream(
  pump: ChildPump,
  declaredLength: number,
  cleanup: () => void
): ReadableStream<Uint8Array> {
  let received = 0;
  let done = false;

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, error?: Error) => {
    if (done) return;
    done = true;
    cleanup();
    if (error) controller.error(error);
    else controller.close();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;

      for (;;) {
        const chunk = pump.shift();
        if (chunk !== undefined) {
          received += chunk.byteLength;
          if (received > declaredLength) {
            finish(
              controller,
              new Error(
                `S3 transfer sent more bytes than declared (${received} > ${declaredLength})`
              )
            );
            return;
          }
          controller.enqueue(new Uint8Array(chunk));
          if (received === declaredLength) {
            // All the declared bytes are through. The child's exit code still
            // matters, but the client has a complete representation.
            finish(controller);
          }
          return;
        }

        const failure = pump.failure();
        if (failure) {
          finish(controller, failure);
          return;
        }

        if (pump.finished()) {
          const exitCode = pump.exitCode();
          if (exitCode !== 0) {
            finish(
              controller,
              new Error(
                `S3 transfer failed (exit code ${exitCode}): ${pump.stderr().trim() || "no details"}`
              )
            );
            return;
          }
          if (received !== declaredLength) {
            finish(
              controller,
              new Error(
                `S3 transfer was truncated: received ${received} of ${declaredLength} bytes`
              )
            );
            return;
          }
          finish(controller);
          return;
        }

        let timer: NodeJS.Timeout | undefined;
        const idle = new Promise<"idle">((resolve) => {
          timer = setTimeout(() => resolve("idle"), BODY_IDLE_TIMEOUT_MS);
        });
        const outcome = await Promise.race([pump.wait().then(() => "data" as const), idle]);
        clearTimeout(timer);
        if (outcome === "idle") {
          finish(controller, new Error("S3 transfer stalled"));
          return;
        }
      }
    },
    cancel() {
      done = true;
      cleanup();
    },
  });
}
