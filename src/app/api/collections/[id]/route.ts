import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryAll, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

// GET /api/collections/[id] — get collection with its books
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
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

  const collection = await queryOne<{
    id: string;
    name: string;
    description: string | null;
    createdAt: number;
    shareToken: string | null;
    sharedAt: number | null;
  }>(
    `
      SELECT
        id,
        name,
        description,
        created_at AS createdAt,
        share_token AS shareToken,
        shared_at AS sharedAt
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

  const countRow = await queryOne<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM collection_books
      WHERE collection_id = ?1
    `,
    [id]
  );
  const total = Number(countRow?.total ?? 0);

  const bookRows = await queryAll<{
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    fileType: string;
    pageCount: number | null;
    addedAt: number;
    updatedAt: number;
    progressStatus: string | null;
    progressPercent: number | null;
    progressLastReadAt: number | null;
  }>(
    `
      SELECT
        b.id,
        b.title,
        b.author,
        b.cover_path AS coverPath,
        b.file_type AS fileType,
        b.page_count AS pageCount,
        b.added_at AS addedAt,
        b.updated_at AS updatedAt,
        rp.status AS progressStatus,
        rp.percent_complete AS progressPercent,
        rp.last_read_at AS progressLastReadAt
      FROM collection_books cb
      INNER JOIN books b ON cb.book_id = b.id
      LEFT JOIN reading_progress rp
        ON rp.book_id = b.id
       AND rp.user_id = ?1
      WHERE cb.collection_id = ?2
      ORDER BY b.title ASC
      LIMIT ?3
      OFFSET ?4
    `,
    [session.user.id, id, limit, offset]
  );

  const booksResponse = bookRows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    coverPath: row.coverPath,
    fileType: row.fileType,
    pageCount: row.pageCount,
    addedAt: row.addedAt,
    updatedAt: row.updatedAt,
    readingProgress:
      row.progressStatus !== null
        ? {
            status: row.progressStatus,
            percentComplete: row.progressPercent,
            lastReadAt: row.progressLastReadAt,
          }
        : null,
  }));

  return NextResponse.json({
    collection,
    books: booksResponse,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  });
}

// PUT /api/collections/[id] — update collection { name?, description? }
export async function PUT(
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

  const setClauses: string[] = [];
  const setValues: Array<string | null> = [];

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 });
    }
    setClauses.push("name = ?");
    setValues.push(name);
  }

  if ("description" in body) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    setClauses.push("description = ?");
    setValues.push(description || null);
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await execute(
    `
      UPDATE collections
      SET ${setClauses.join(", ")}
      WHERE id = ?
        AND user_id = ?
    `,
    [...setValues, id, session.user.id]
  );

  const updated = await queryOne<{
    id: string;
    name: string;
    description: string | null;
    createdAt: number;
    shareToken: string | null;
    sharedAt: number | null;
  }>(
    `
      SELECT
        id,
        name,
        description,
        created_at AS createdAt,
        share_token AS shareToken,
        shared_at AS sharedAt
      FROM collections
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

  return NextResponse.json(updated);
}

// DELETE /api/collections/[id] — delete collection (books not deleted)
export async function DELETE(
  _req: Request,
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

  await execute("DELETE FROM collection_books WHERE collection_id = ?1", [id]);
  await execute("DELETE FROM collections WHERE id = ?1 AND user_id = ?2", [id, session.user.id]);

  return NextResponse.json({ success: true });
}

