import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";
import { serveBookFile } from "@/lib/files/serve-book-file";

// Prevent Next.js from attempting to statically analyze this route during build
export const dynamic = 'force-dynamic';

// GET /api/books/[id]/book.epub — serves the epub file with .epub extension
// This endpoint exists solely for epub.js compatibility, which needs a URL ending in .epub
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

  if (book.fileType !== "epub") {
    return NextResponse.json({ error: "Not an EPUB book" }, { status: 400 });
  }

  return await serveBookFile(book, req, {
    contentTypeOverride: "application/epub+zip",
    filenameOverride: "book.epub",
  });
}
