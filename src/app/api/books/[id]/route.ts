import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, readingProgress } from "@/lib/db/schema";

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

  const joinCond = and(
    eq(readingProgress.bookId, books.id),
    eq(readingProgress.userId, session.user.id),
  );

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      description: books.description,
      fileType: books.fileType,
      filePath: books.filePath,
      fileSize: books.fileSize,
      fileHash: books.fileHash,
      coverPath: books.coverPath,
      pageCount: books.pageCount,
      addedAt: books.addedAt,
      updatedAt: books.updatedAt,
      progressStatus: readingProgress.status,
      progressCurrentPage: readingProgress.currentPage,
      progressTotalPages: readingProgress.totalPages,
      progressEpubLocation: readingProgress.epubLocation,
      progressPercent: readingProgress.percentComplete,
      progressLastReadAt: readingProgress.lastReadAt,
    })
    .from(books)
    .leftJoin(readingProgress, joinCond)
    .where(eq(books.id, id));

  if (rows.length === 0) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const row = rows[0];

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
