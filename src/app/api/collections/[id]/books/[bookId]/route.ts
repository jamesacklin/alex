import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { collectionBooks, collections } from "@/lib/db/schema";

// DELETE /api/collections/[id]/books/[bookId] — remove book
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; bookId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, bookId } = await params;

  const [collection] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  const [existing] = await db
    .select({ collectionId: collectionBooks.collectionId })
    .from(collectionBooks)
    .where(and(eq(collectionBooks.collectionId, id), eq(collectionBooks.bookId, bookId)));

  if (!existing) {
    return NextResponse.json({ error: "Book not in collection" }, { status: 404 });
  }

  await db
    .delete(collectionBooks)
    .where(and(eq(collectionBooks.collectionId, id), eq(collectionBooks.bookId, bookId)));

  return NextResponse.json({ success: true });
}
