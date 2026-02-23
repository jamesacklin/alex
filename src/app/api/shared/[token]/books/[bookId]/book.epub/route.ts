import { NextResponse } from "next/server";
import { getSharedBook } from "@/lib/shared";
import { serveBookFile } from "@/lib/files/serve-book-file";

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

  return await serveBookFile(book, req, {
    cacheControl: "private, max-age=3600, must-revalidate",
    contentTypeOverride: "application/epub+zip",
    filenameOverride: "book.epub",
  });
}
