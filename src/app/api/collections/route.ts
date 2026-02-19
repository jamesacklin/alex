import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryAll, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

// GET /api/collections — list current user's collections with book counts
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId")?.trim() || "";

  const rows = await queryAll<{
    id: string;
    name: string;
    description: string | null;
    createdAt: number;
    shareToken: string | null;
    bookCount: number;
  }>(
    `
      SELECT
        c.id,
        c.name,
        c.description,
        c.created_at AS createdAt,
        c.share_token AS shareToken,
        COUNT(cb.book_id) AS bookCount
      FROM collections c
      LEFT JOIN collection_books cb ON cb.collection_id = c.id
      WHERE c.user_id = ?1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `,
    [session.user.id]
  );

  if (!bookId) {
    return NextResponse.json({ collections: rows });
  }

  if (rows.length === 0) {
    return NextResponse.json({ collections: [] });
  }

  const placeholders = rows.map(() => "?").join(", ");
  const membershipRows = await queryAll<{ collectionId: string }>(
    `
      SELECT collection_id AS collectionId
      FROM collection_books
      WHERE book_id = ?
        AND collection_id IN (${placeholders})
    `,
    [bookId, ...rows.map((row) => row.id)]
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

  const existingUser = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE id = ?1
      LIMIT 1
    `,
    [session.user.id]
  );

  if (!existingUser) {
    return NextResponse.json({ error: "User not found, try logging in again" }, { status: 404 });
  }

  await execute(
    `
      INSERT INTO collections (id, user_id, name, description, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `,
    [id, session.user.id, name, description || null, createdAt]
  );

  return NextResponse.json({ id, name, description: description || null, createdAt }, { status: 201 });
}

