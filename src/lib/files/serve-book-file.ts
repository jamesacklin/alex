import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Readable } from "stream";
import { NextResponse } from "next/server";

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
  options: ServeBookFileOptions,
  status: number
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

  if (status === 206) {
    // Set by caller in range scenarios.
    headers["Content-Range"] = "";
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
  const rangeHeader = req.headers.get("range");
  let start = 0;
  let end = fileSize - 1;
  let status = 200;

  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const reqStart = match[1] ? Number(match[1]) : undefined;
    const reqEnd = match[2] ? Number(match[2]) : undefined;

    if (reqStart !== undefined) {
      start = reqStart;
      end = reqEnd !== undefined ? reqEnd : fileSize - 1;
    } else if (reqEnd !== undefined) {
      start = fileSize - reqEnd;
      end = fileSize - 1;
    }

    if (start < 0 || start >= fileSize || end >= fileSize || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    status = 206;
  }

  const stream = fs.createReadStream(book.filePath, { start, end });
  const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  const headers = buildResponseHeaders(book, end - start + 1, options, status);

  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  } else {
    delete headers["Content-Range"];
  }

  return new NextResponse(webStream, { status, headers });
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

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (response: NextResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(response);
    };

    const child = spawn(binaryPath, args, {
      env: watcherEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let headerParsed = false;
    let headerBuf = Buffer.alloc(0);
    let meta: {
      content_type?: string;
      content_length?: number;
      status?: number;
      range_start?: number;
      range_end?: number;
    } | null = null;
    const bodyChunks: Uint8Array[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (headerParsed) {
        bodyChunks.push(new Uint8Array(chunk));
        return;
      }

      headerBuf = Buffer.concat([headerBuf, chunk]);
      const newlineIdx = headerBuf.indexOf(0x0a);
      if (newlineIdx === -1) {
        return;
      }

      headerParsed = true;
      const headerLine = headerBuf.subarray(0, newlineIdx).toString("utf8").trim();
      const remaining = headerBuf.subarray(newlineIdx + 1);
      if (remaining.length > 0) {
        bodyChunks.push(new Uint8Array(remaining));
      }

      try {
        meta = JSON.parse(headerLine) as {
          content_type?: string;
          content_length?: number;
          status?: number;
          range_start?: number;
          range_end?: number;
        };
      } catch {
        finish(
          NextResponse.json(
            { error: "Failed to parse S3 stream header", details: headerLine },
            { status: 500 }
          )
        );
      }
    });

    child.on("close", (code) => {
      if (!headerParsed || !meta) {
        finish(
          NextResponse.json(
            {
              error: "S3 stream failed before response header",
              exitCode: code,
              details: stderr.trim() || undefined,
            },
            { status: 502 }
          )
        );
        return;
      }

      const body = concatUint8Arrays(bodyChunks);
      const normalizedBody = new Uint8Array(body.length);
      normalizedBody.set(body);
      const responseBody = new Blob([normalizedBody]);
      const status = meta.status || 200;
      const headers = buildResponseHeaders(book, body.length, options, status);

      if (status === 206 && meta.range_start !== undefined) {
        headers["Content-Range"] = `bytes ${meta.range_start}-${meta.range_end}/${meta.content_length}`;
      } else {
        delete headers["Content-Range"];
      }

      if (!options.contentTypeOverride && meta.content_type) {
        headers["Content-Type"] = meta.content_type;
      }

      finish(new NextResponse(responseBody, { status, headers }));
    });

    child.on("error", (error) => {
      finish(
        NextResponse.json(
          { error: "Failed to spawn S3 stream", details: error.message },
          { status: 500 }
        )
      );
    });

    const timeoutId = setTimeout(() => {
      child.kill();
      if (!headerParsed) {
        finish(NextResponse.json({ error: "S3 stream timeout" }, { status: 504 }));
      }
    }, 30_000);
  });
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
