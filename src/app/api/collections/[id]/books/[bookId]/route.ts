import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

// DELETE /api/collections/[id]/books/[bookId] — remove book
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; bookId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, bookId } = await params;

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

  if (!existing) {
    return NextResponse.json({ error: "Book not in collection" }, { status: 404 });
  }

  await execute(
    `
      DELETE FROM collection_books
      WHERE collection_id = ?1
        AND book_id = ?2
    `,
    [id, bookId]
  );

  return NextResponse.json({ success: true });
}

