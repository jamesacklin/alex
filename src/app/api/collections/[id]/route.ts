import { NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books, collectionBooks, collections } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

// GET /api/collections/[id] — get collection with its books
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 24));
  const offset = (page - 1) * limit;

  const [collection] = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      createdAt: collections.createdAt,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  // Get total count of books in this collection
  const [{ total }] = await db
    .select({ total: count() })
    .from(collectionBooks)
    .where(eq(collectionBooks.collectionId, id));

  // Get paginated books
  const bookRows = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      fileType: books.fileType,
      pageCount: books.pageCount,
      addedAt: books.addedAt,
      updatedAt: books.updatedAt,
    })
    .from(collectionBooks)
    .innerJoin(books, eq(collectionBooks.bookId, books.id))
    .where(eq(collectionBooks.collectionId, id))
    .orderBy(asc(books.title))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    collection,
    books: bookRows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  });
}

// PUT /api/collections/[id] — update collection { name?, description? }
export async function PUT(
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

  const updates: { name?: string; description?: string | null } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 });
    }
    updates.name = name;
  }

  if ("description" in body) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    updates.description = description || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await db
    .update(collections)
    .set(updates)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  const [updated] = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      createdAt: collections.createdAt,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  return NextResponse.json(updated);
}

// DELETE /api/collections/[id] — delete collection (books not deleted)
export async function DELETE(
  _req: Request,
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

  await db.delete(collectionBooks).where(eq(collectionBooks.collectionId, id));
  await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  return NextResponse.json({ success: true });
}
