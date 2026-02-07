import { NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { getSharedCollection } from "@/lib/shared";
import { db } from "@/lib/db";
import { books, collectionBooks } from "@/lib/db/schema";

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
  const [totalResult] = await db
    .select({ count: count() })
    .from(collectionBooks)
    .where(eq(collectionBooks.collectionId, collection.id));

  const total = totalResult?.count ?? 0;
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;

  // Get paginated books
  const booksList = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      fileType: books.fileType,
      pageCount: books.pageCount,
    })
    .from(books)
    .innerJoin(collectionBooks, eq(books.id, collectionBooks.bookId))
    .where(eq(collectionBooks.collectionId, collection.id))
    .limit(limit)
    .offset(offset);

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
