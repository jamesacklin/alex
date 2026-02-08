import { NextResponse } from "next/server";
import fs from "fs";
import { getSharedBook } from "@/lib/shared";

export const dynamic = "force-dynamic";

// GET /api/shared/[token]/books/[bookId]/book.epub — serves the epub file with .epub extension
// This endpoint exists solely for epub.js compatibility, which needs a URL ending in .epub
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; bookId: string }> }
) {
  const { token, bookId } = await params;

  // Validate token and book membership
  const book = await getSharedBook(token, bookId);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Check file exists on disk
  if (!fs.existsSync(book.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  // Read and serve the EPUB file
  const fileBuffer = fs.readFileSync(book.filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `inline; filename="book.epub"`,
      "Cache-Control": "public, max-age=31536000",
    },
  });
}
