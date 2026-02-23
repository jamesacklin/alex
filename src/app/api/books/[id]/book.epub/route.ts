import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";

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

  const book = await queryOne<{ fileType: string }>(
    `
      SELECT
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

  if (book.fileType !== "epub") {
    return NextResponse.json({ error: "Not an EPUB book" }, { status: 400 });
  }

  const fileResponse = await fetch(new URL(`/api/books/${id}/file`, req.url), {
    method: "GET",
    headers: req.headers,
  });

  const responseHeaders = new Headers(fileResponse.headers);
  responseHeaders.set("Content-Type", "application/epub+zip");
  responseHeaders.set("Content-Disposition", 'inline; filename="book.epub"');

  return new NextResponse(fileResponse.body, {
    status: fileResponse.status,
    headers: responseHeaders,
  });
}
