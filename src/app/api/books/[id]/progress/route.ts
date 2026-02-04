import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, readingProgress } from "@/lib/db/schema";

// GET /api/books/[id]/progress — current user's progress or null
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, id));
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const [row] = await db
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.bookId, id), eq(readingProgress.userId, session.user.id)));

  if (!row) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    id: row.id,
    currentPage: row.currentPage,
    totalPages: row.totalPages,
    percentComplete: row.percentComplete,
    status: row.status,
    lastReadAt: row.lastReadAt,
  });
}

// PUT /api/books/[id]/progress — upsert progress
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, id));
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  let body: { currentPage: number; totalPages: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { currentPage, totalPages } = body;

  if (typeof currentPage !== "number" || typeof totalPages !== "number" || totalPages < 1) {
    return NextResponse.json({ error: "Invalid body: currentPage and totalPages (>=1) required" }, { status: 400 });
  }

  const percentComplete = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const status = currentPage >= totalPages ? "completed" : "reading";
  const now = Math.floor(Date.now() / 1000);

  const [existing] = await db
    .select({ id: readingProgress.id })
    .from(readingProgress)
    .where(and(eq(readingProgress.bookId, id), eq(readingProgress.userId, session.user.id)));

  if (existing) {
    await db
      .update(readingProgress)
      .set({ currentPage, totalPages, percentComplete, status, lastReadAt: now })
      .where(eq(readingProgress.id, existing.id));
  } else {
    await db.insert(readingProgress).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      bookId: id,
      currentPage,
      totalPages,
      percentComplete,
      status,
      lastReadAt: now,
    });
  }

  return NextResponse.json({
    currentPage,
    totalPages,
    percentComplete,
    status,
    lastReadAt: now,
  });
}
