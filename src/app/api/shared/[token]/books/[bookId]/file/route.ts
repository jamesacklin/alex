import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getSharedBook } from "@/lib/shared";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; bookId: string }> }
) {
  const { token, bookId } = await params;

  // Validate token and book membership
  const book = await getSharedBook(token, bookId);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Check file exists on disk
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
