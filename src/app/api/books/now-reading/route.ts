import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, readingProgress } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all books with status='reading' for this user
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      fileType: books.fileType,
      pageCount: books.pageCount,
      updatedAt: books.updatedAt,
      progressStatus: readingProgress.status,
      progressPercent: readingProgress.percentComplete,
      progressLastReadAt: readingProgress.lastReadAt,
    })
    .from(readingProgress)
    .innerJoin(books, eq(readingProgress.bookId, books.id))
    .where(
      and(
        eq(readingProgress.userId, session.user.id),
        eq(readingProgress.status, "reading")
      )
    )
    .orderBy(desc(readingProgress.lastReadAt));

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
