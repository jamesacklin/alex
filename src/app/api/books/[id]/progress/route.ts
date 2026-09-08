import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

// GET /api/books/[id]/progress — current user's progress or null
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const book = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM books
      WHERE id = ?1
      LIMIT 1
    `,
    [id]
  );
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const row = await queryOne<{
    id: string;
    currentPage: number;
    totalPages: number | null;
    epubLocation: string | null;
    percentComplete: number;
    status: string;
    lastReadAt: number | null;
  }>(
    `
      SELECT
        id,
        current_page AS currentPage,
        total_pages AS totalPages,
        epub_location AS epubLocation,
        percent_complete AS percentComplete,
        status,
        last_read_at AS lastReadAt
      FROM reading_progress
      WHERE book_id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

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
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const book = await queryOne<{ id: string; fileType: string }>(
    `
      SELECT
        id,
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  // --- ePub ----------------------------------------------------------
  if (book.fileType === "epub") {
    const { epubLocation, percentComplete } = body;

    if (typeof epubLocation !== "string" || !epubLocation) {
      return NextResponse.json(
        { error: "epubLocation (non-empty string) is required for ePub books" },
        { status: 400 }
      );
    }
    if (typeof percentComplete !== "number" || percentComplete < 0 || percentComplete > 100) {
      return NextResponse.json(
        { error: "percentComplete (number 0–100) is required for ePub books" },
        { status: 400 }
      );
    }

    const status = percentComplete >= 100 ? "completed" : "reading";

    // Atomic upsert against the (user_id, book_id) unique index. The former
    // SELECT-then-INSERT let two concurrent first saves both miss and both
    // insert, leaving duplicate rows that made book-list joins repeat books
    // and made an unordered `LIMIT 1` pick arbitrarily between them.
    await execute(
      `
        INSERT INTO reading_progress (
          id, user_id, book_id, epub_location, percent_complete, status, last_read_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          epub_location = excluded.epub_location,
          percent_complete = excluded.percent_complete,
          status = excluded.status,
          last_read_at = excluded.last_read_at
      `,
      [crypto.randomUUID(), session.user.id, id, epubLocation, percentComplete, status, now]
    );

    return NextResponse.json({ epubLocation, percentComplete, status, lastReadAt: now });
  }

  // --- PDF -----------------------------------------------------------
  const { currentPage, totalPages } = body as { currentPage: number; totalPages: number };

  if (typeof currentPage !== "number" || typeof totalPages !== "number" || totalPages < 1) {
    return NextResponse.json(
      { error: "currentPage and totalPages (>= 1) are required for PDF books" },
      { status: 400 }
    );
  }

  const percentComplete = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const status = currentPage >= totalPages ? "completed" : "reading";

  await execute(
    `
      INSERT INTO reading_progress (
        id, user_id, book_id, current_page, total_pages, percent_complete, status, last_read_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        current_page = excluded.current_page,
        total_pages = excluded.total_pages,
        percent_complete = excluded.percent_complete,
        status = excluded.status,
        last_read_at = excluded.last_read_at
    `,
    [crypto.randomUUID(), session.user.id, id, currentPage, totalPages, percentComplete, status, now]
  );

  return NextResponse.json({ currentPage, totalPages, percentComplete, status, lastReadAt: now });
}

