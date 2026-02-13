import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, collectionBooks, collections } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

// POST /api/collections/[id]/books — add book { bookId }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [collection] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

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

  const [book] = await db.select({ id: books.id }).from(books).where(eq(books.id, bookId));
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const [existing] = await db
    .select({ collectionId: collectionBooks.collectionId })
    .from(collectionBooks)
    .where(and(eq(collectionBooks.collectionId, id), eq(collectionBooks.bookId, bookId)));

  if (existing) {
    return NextResponse.json({ collectionId: id, bookId, added: false });
  }

  await db.insert(collectionBooks).values({
    collectionId: id,
    bookId,
    addedAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ collectionId: id, bookId, added: true }, { status: 201 });
}
