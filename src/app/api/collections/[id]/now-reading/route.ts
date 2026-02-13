import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, collectionBooks, collections, readingProgress } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify collection ownership
  const [collection] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  // Get all books in this collection with status='reading' for this user
  const joinCond = and(
    eq(readingProgress.bookId, books.id),
    eq(readingProgress.userId, session.user.id),
  );

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
    .from(collectionBooks)
    .innerJoin(books, eq(collectionBooks.bookId, books.id))
    .innerJoin(readingProgress, joinCond)
    .where(
      and(
        eq(collectionBooks.collectionId, id),
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
