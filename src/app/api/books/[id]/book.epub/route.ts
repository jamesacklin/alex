import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";
import fs from "fs";

// Prevent Next.js from attempting to statically analyze this route during build
export const dynamic = 'force-dynamic';

// GET /api/books/[id]/book.epub — serves the epub file with .epub extension
// This endpoint exists solely for epub.js compatibility, which needs a URL ending in .epub
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const book = await queryOne<{ filePath: string; fileType: string }>(
    `
      SELECT
        file_path AS filePath,
        file_type AS fileType
      FROM books
      WHERE id = ?1
      LIMIT 1
    `,
    [id]
  );

  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  if (!fs.existsSync(book.filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(book.filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `inline; filename="book.epub"`,
      "Cache-Control": "public, max-age=31536000",
    },
  });
}
