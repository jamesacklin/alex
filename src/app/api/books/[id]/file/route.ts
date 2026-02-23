import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { spawn } from "child_process";
import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";

export const dynamic = 'force-dynamic';

/** True when S3 env vars are configured (S3 mode). */
const isS3Mode = Boolean(process.env.S3_BUCKET);

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const book = await queryOne<{ filePath: string; fileType: string; source: string }>(
    `
      SELECT
        file_path AS filePath,
        file_type AS fileType,
        source
      FROM books
      WHERE id = ?1
      LIMIT 1
    `,
    [id]
  );

  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // S3 mode: stream via watcher-rs s3-stream subcommand
  if (isS3Mode && book.source === "s3") {
    return streamFromS3(book, req);
  }

  // Local mode: stream from filesystem
  return streamFromDisk(book, req);
}

function streamFromDisk(
  book: { filePath: string; fileType: string },
  req: Request,
): NextResponse {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(book.filePath);
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const fileSize = stat.size;
  const contentType = book.fileType === "epub" ? "application/epub+zip" : "application/pdf";

  // Parse Range header
  const rangeHeader = req.headers.get("range");
  let start = 0;
  let end = fileSize - 1;
  let status: number = 200;

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
      // suffix range: bytes=-N means last N bytes
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

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
  };

  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  }

  return new NextResponse(webStream, { status, headers });
}

/**
 * Stream a book from S3 via the watcher-rs s3-stream subcommand.
 *
 * Protocol: watcher-rs writes a JSON header line to stdout, then raw bytes.
 * We parse the header for content_length/content_type, then pipe the rest.
 */
async function streamFromS3(
  book: { filePath: string; fileType: string },
  req: Request,
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

  return new Promise((resolve) => {
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

      // Buffer until we find a newline (end of JSON header line)
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
            { status: 500 },
          ),
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
            { status: 502 },
          ),
        );
        return;
      }

      const body = concatUint8Arrays(bodyChunks);
      const normalizedBody = new Uint8Array(body.length);
      normalizedBody.set(body);
      const responseBody = new Blob([normalizedBody]);
      const headers: Record<string, string> = {
        "Content-Type": meta.content_type || "application/octet-stream",
        "Content-Disposition": "inline",
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.length),
      };

      const status = meta.status || 200;
      if (status === 206 && meta.range_start !== undefined) {
        headers["Content-Range"] =
          `bytes ${meta.range_start}-${meta.range_end}/${meta.content_length}`;
      }

      finish(new NextResponse(responseBody, { status, headers }));
    });

    child.on("error", (error) => {
      finish(
        NextResponse.json(
          { error: "Failed to spawn S3 stream", details: error.message },
          { status: 500 },
        ),
      );
    });

    // Timeout after 30 seconds
    const timeoutId = setTimeout(() => {
      child.kill();
      if (!headerParsed) {
        finish(
          NextResponse.json({ error: "S3 stream timeout" }, { status: 504 }),
        );
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
