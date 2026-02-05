import { NextResponse } from "next/server";
import { and, asc, count, desc, eq, isNull, like, or } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, readingProgress } from "@/lib/db/schema";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const type = url.searchParams.get("type") || "all";
  const status = url.searchParams.get("status") || "all";
  const sort = url.searchParams.get("sort") || "added";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 24));
  const offset = (page - 1) * limit;

  // LEFT JOIN: only the current user's reading progress
  const joinCond = and(
    eq(readingProgress.bookId, books.id),
    eq(readingProgress.userId, session.user.id),
  );

  // Accumulate WHERE predicates
  const conditions = [];

  if (q) {
    conditions.push(
      or(like(books.title, `%${q}%`), like(books.author, `%${q}%`)),
    );
  }

  if (type !== "all") {
    conditions.push(eq(books.fileType, type));
  }

  // Status filter — "not_started" covers both no row and explicit not_started
  if (status === "not_started") {
    conditions.push(
      or(isNull(readingProgress.status), eq(readingProgress.status, "not_started")),
    );
  } else if (status === "reading") {
    conditions.push(eq(readingProgress.status, "reading"));
  } else if (status === "completed") {
    conditions.push(eq(readingProgress.status, "completed"));
  }

  // ORDER BY
  const orderBy = (() => {
    switch (sort) {
      case "title":
        return asc(books.title);
      case "author":
        return asc(books.author);
      case "read":
        return desc(readingProgress.lastReadAt);
      default:
        return desc(books.addedAt);
    }
  })();

  // Shared base: both count and data queries need the same join + where
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count (same filters, no order/limit)
  const countQ = where
    ? db.select({ total: count() }).from(books).leftJoin(readingProgress, joinCond).where(where)
    : db.select({ total: count() }).from(books).leftJoin(readingProgress, joinCond);
  const [{ total }] = await countQ;

  // Paginated data
  const dataQ = where
    ? db
        .select({
          id: books.id,
          title: books.title,
          author: books.author,
          coverPath: books.coverPath,
          fileType: books.fileType,
          pageCount: books.pageCount,
          addedAt: books.addedAt,
          updatedAt: books.updatedAt,
          progressStatus: readingProgress.status,
          progressPercent: readingProgress.percentComplete,
          progressLastReadAt: readingProgress.lastReadAt,
        })
        .from(books)
        .leftJoin(readingProgress, joinCond)
        .where(where)
    : db
        .select({
          id: books.id,
          title: books.title,
          author: books.author,
          coverPath: books.coverPath,
          fileType: books.fileType,
          pageCount: books.pageCount,
          addedAt: books.addedAt,
          updatedAt: books.updatedAt,
          progressStatus: readingProgress.status,
          progressPercent: readingProgress.percentComplete,
          progressLastReadAt: readingProgress.lastReadAt,
        })
        .from(books)
        .leftJoin(readingProgress, joinCond);

  const rows = await dataQ.orderBy(orderBy).limit(limit).offset(offset);

  const booksResponse = rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    coverPath: row.coverPath,
    fileType: row.fileType,
    pageCount: row.pageCount,
    updatedAt: row.updatedAt,
    readingProgress: row.progressStatus !== null
      ? {
          status: row.progressStatus,
          percentComplete: row.progressPercent,
          lastReadAt: row.progressLastReadAt,
        }
      : null,
  }));

  return NextResponse.json({
    books: booksResponse,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
