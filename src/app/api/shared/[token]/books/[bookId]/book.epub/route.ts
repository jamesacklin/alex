import { NextResponse } from "next/server";
import { getSharedBook } from "@/lib/shared";

export const dynamic = "force-dynamic";

// GET /api/shared/[token]/books/[bookId]/book.epub — serves the epub file with .epub extension
// This endpoint exists solely for epub.js compatibility, which needs a URL ending in .epub
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

  if (book.fileType !== "epub") {
    return NextResponse.json({ error: "Not an EPUB book" }, { status: 400 });
  }

  const fileResponse = await fetch(
    new URL(`/api/shared/${token}/books/${bookId}/file`, req.url),
    {
      method: "GET",
      headers: req.headers,
    }
  );

  const responseHeaders = new Headers(fileResponse.headers);
  responseHeaders.set("Content-Type", "application/epub+zip");
  responseHeaders.set("Content-Disposition", 'inline; filename="book.epub"');

  return new NextResponse(fileResponse.body, {
    status: fileResponse.status,
    headers: responseHeaders,
  });
}
