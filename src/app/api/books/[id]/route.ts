import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryOne } from "@/lib/db/rust";

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

  const row = await queryOne<{
    id: string;
    title: string;
    author: string | null;
    description: string | null;
    fileType: string;
    filePath: string;
    fileSize: number;
    fileHash: string;
    coverPath: string | null;
    pageCount: number | null;
    addedAt: number;
    updatedAt: number;
    progressStatus: string | null;
    progressCurrentPage: number | null;
    progressTotalPages: number | null;
    progressEpubLocation: string | null;
    progressPercent: number | null;
    progressLastReadAt: number | null;
  }>(
    `
      SELECT
        b.id,
        b.title,
        b.author,
        b.description,
        b.file_type AS fileType,
        b.file_path AS filePath,
        b.file_size AS fileSize,
        b.file_hash AS fileHash,
        b.cover_path AS coverPath,
        b.page_count AS pageCount,
        b.added_at AS addedAt,
        b.updated_at AS updatedAt,
        rp.status AS progressStatus,
        rp.current_page AS progressCurrentPage,
        rp.total_pages AS progressTotalPages,
        rp.epub_location AS progressEpubLocation,
        rp.percent_complete AS progressPercent,
        rp.last_read_at AS progressLastReadAt
      FROM books b
      LEFT JOIN reading_progress rp
        ON rp.book_id = b.id
       AND rp.user_id = ?1
      WHERE b.id = ?2
      LIMIT 1
    `,
    [session.user.id, id]
  );

  if (!row) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    fileType: row.fileType,
    filePath: row.filePath,
    fileSize: row.fileSize,
    fileHash: row.fileHash,
    coverPath: row.coverPath,
    pageCount: row.pageCount,
    addedAt: row.addedAt,
    updatedAt: row.updatedAt,
    readingProgress: row.progressStatus !== null
      ? {
          status: row.progressStatus,
          currentPage: row.progressCurrentPage,
          totalPages: row.progressTotalPages,
          epubLocation: row.progressEpubLocation,
          percentComplete: row.progressPercent,
          lastReadAt: row.progressLastReadAt,
        }
      : null,
  });
}
