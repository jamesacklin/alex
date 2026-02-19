import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

// POST /api/collections/[id]/books — add book { bookId }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const collection = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM collections
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
  if (!bookId) {
    return NextResponse.json({ error: "bookId is required" }, { status: 400 });
  }

  const book = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM books
      WHERE id = ?1
      LIMIT 1
    `,
    [bookId]
  );
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const existing = await queryOne<{ collectionId: string }>(
    `
      SELECT collection_id AS collectionId
      FROM collection_books
      WHERE collection_id = ?1
        AND book_id = ?2
      LIMIT 1
    `,
    [id, bookId]
  );

  if (existing) {
    return NextResponse.json({ collectionId: id, bookId, added: false });
  }

  await execute(
    `
      INSERT INTO collection_books (collection_id, book_id, added_at)
      VALUES (?1, ?2, ?3)
    `,
    [id, bookId, Math.floor(Date.now() / 1000)]
  );

  return NextResponse.json({ collectionId: id, bookId, added: true }, { status: 201 });
}

