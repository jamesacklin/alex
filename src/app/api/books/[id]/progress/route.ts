import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, readingProgress } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

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
    epubLocation: row.epubLocation,
    percentComplete: row.percentComplete,
    status: row.status,
    lastReadAt: row.lastReadAt,
  });
}

// PUT /api/books/[id]/progress — upsert progress for the current user.
// PDF body:  { currentPage, totalPages }
// ePub body: { epubLocation, percentComplete }
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [book] = await db
    .select({ id: books.id, fileType: books.fileType })
    .from(books)
    .where(eq(books.id, id));
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  // Look up an existing progress row once — used by both branches below.
  const [existing] = await db
    .select({ id: readingProgress.id })
    .from(readingProgress)
    .where(and(eq(readingProgress.bookId, id), eq(readingProgress.userId, session.user.id)));

  // --- ePub ----------------------------------------------------------
  if (book.fileType === "epub") {
    const { epubLocation, percentComplete } = body;

    if (typeof epubLocation !== "string" || !epubLocation) {
      return NextResponse.json(
        { error: "epubLocation (non-empty string) is required for ePub books" },
        { status: 400 },
      );
    }
    if (typeof percentComplete !== "number" || percentComplete < 0 || percentComplete > 100) {
      return NextResponse.json(
        { error: "percentComplete (number 0–100) is required for ePub books" },
        { status: 400 },
      );
    }

    const status = percentComplete >= 100 ? "completed" : "reading";

    if (existing) {
      await db
        .update(readingProgress)
        .set({ epubLocation, percentComplete, status, lastReadAt: now })
        .where(eq(readingProgress.id, existing.id));
    } else {
      await db.insert(readingProgress).values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        bookId: id,
        epubLocation,
        percentComplete,
        status,
        lastReadAt: now,
      });
    }

    return NextResponse.json({ epubLocation, percentComplete, status, lastReadAt: now });
  }

  // --- PDF -----------------------------------------------------------
  const { currentPage, totalPages } = body as { currentPage: number; totalPages: number };

  if (typeof currentPage !== "number" || typeof totalPages !== "number" || totalPages < 1) {
    return NextResponse.json(
      { error: "currentPage and totalPages (>= 1) are required for PDF books" },
      { status: 400 },
    );
  }

  const percentComplete = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const status = currentPage >= totalPages ? "completed" : "reading";

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

  return NextResponse.json({ currentPage, totalPages, percentComplete, status, lastReadAt: now });
}
