import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";
import { serveBookFile } from "@/lib/files/serve-book-file";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
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

  return await serveBookFile(book, req);
}
