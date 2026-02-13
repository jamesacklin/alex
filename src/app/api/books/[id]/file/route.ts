import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [book] = await db
    .select({ filePath: books.filePath, fileType: books.fileType })
    .from(books)
    .where(eq(books.id, id));

  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

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
