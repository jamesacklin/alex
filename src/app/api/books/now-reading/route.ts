import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { queryAll } from "@/lib/db/rust";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all books with status='reading' for this user
  const rows = await queryAll<{
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    fileType: string;
    pageCount: number | null;
    updatedAt: number;
    progressStatus: string;
    progressPercent: number;
    progressLastReadAt: number | null;
  }>(
    `
      SELECT
        b.id,
        b.title,
        b.author,
        b.cover_path AS coverPath,
        b.file_type AS fileType,
        b.page_count AS pageCount,
        b.updated_at AS updatedAt,
        rp.status AS progressStatus,
        rp.percent_complete AS progressPercent,
        rp.last_read_at AS progressLastReadAt
      FROM reading_progress rp
      INNER JOIN books b ON rp.book_id = b.id
      WHERE rp.user_id = ?1
        AND rp.status = 'reading'
      ORDER BY rp.last_read_at DESC
    `,
    [session.user.id]
  );

  const booksResponse = rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    coverPath: row.coverPath,
    fileType: row.fileType,
    pageCount: row.pageCount,
    updatedAt: row.updatedAt,
    readingProgress: {
      status: row.progressStatus,
      percentComplete: row.progressPercent,
      lastReadAt: row.progressLastReadAt,
    },
  }));

  return NextResponse.json({ books: booksResponse });
}
