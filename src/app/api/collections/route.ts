import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { collectionBooks, collections, users } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

// GET /api/collections — list current user's collections with book counts
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId")?.trim() || "";

  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      createdAt: collections.createdAt,
      shareToken: collections.shareToken,
      bookCount: count(collectionBooks.bookId),
    })
    .from(collections)
    .leftJoin(collectionBooks, eq(collectionBooks.collectionId, collections.id))
    .where(eq(collections.userId, session.user.id))
    .groupBy(collections.id)
    .orderBy(desc(collections.createdAt));

  if (!bookId) {
    return NextResponse.json({ collections: rows });
  }

  if (rows.length === 0) {
    return NextResponse.json({ collections: [] });
  }

  const membershipRows = await db
    .select({ collectionId: collectionBooks.collectionId })
    .from(collectionBooks)
    .where(
      and(
        eq(collectionBooks.bookId, bookId),
        inArray(
          collectionBooks.collectionId,
          rows.map((row) => row.id),
        ),
      ),
    );

  const membership = new Set(membershipRows.map((row) => row.collectionId));
  const collectionsWithMembership = rows.map((row) => ({
    ...row,
    containsBook: membership.has(row.id),
  }));

  return NextResponse.json({ collections: collectionsWithMembership });
}

// POST /api/collections — create collection { name, description? }
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!existingUser) {
    return NextResponse.json({ error: "User not found, try logging in again" }, { status: 404 });
  }

  await db.insert(collections).values({
    id,
    userId: session.user.id,
    name,
    description: description || null,
    createdAt,
  });

  return NextResponse.json({ id, name, description: description || null, createdAt }, { status: 201 });
}
