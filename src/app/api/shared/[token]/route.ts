import { NextResponse } from "next/server";
import { getSharedCollection } from "@/lib/shared";
import { queryAll, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Validate token and get collection
  const collection = await getSharedCollection(token);
  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  // Parse pagination params
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") || "24"));
  const offset = (page - 1) * limit;

  // Get total count of books in collection
  const totalResult = await queryOne<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM collection_books
      WHERE collection_id = ?1
    `,
    [collection.id]
  );
  const total = Number(totalResult?.count ?? 0);
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;

  // Get paginated books
  const booksList = await queryAll<{
    id: string;
    title: string;
    author: string | null;
    fileType: string;
    pageCount: number | null;
  }>(
    `
      SELECT
        b.id,
        b.title,
        b.author,
        b.file_type AS fileType,
        b.page_count AS pageCount
      FROM books b
      INNER JOIN collection_books cb ON b.id = cb.book_id
      WHERE cb.collection_id = ?1
      LIMIT ?2
      OFFSET ?3
    `,
    [collection.id, limit, offset]
  );

  // Add coverUrl to each book
  const booksWithCovers = booksList.map((book) => ({
    ...book,
    coverUrl: `/api/shared/${token}/covers/${book.id}`,
  }));

  return NextResponse.json({
    collection: {
      name: collection.name,
      description: collection.description,
    },
    books: booksWithCovers,
    total,
    page,
    totalPages,
    hasMore,
  });
}
