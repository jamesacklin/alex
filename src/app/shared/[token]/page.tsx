import { notFound } from "next/navigation";
import { getSharedCollection } from "@/lib/shared";
import { db } from "@/lib/db";
import { books, collectionBooks } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import SharedCollectionClient from "./shared-collection-client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const collection = await getSharedCollection(token);

  if (!collection) {
    return {
      title: "Collection Not Found",
    };
  }

  return {
    title: `${collection.name} - Shared Collection`,
    description: collection.description || `Browse books in ${collection.name}`,
  };
}

export default async function SharedCollectionPage({ params }: PageProps) {
  const { token } = await params;

  // Validate token and get collection
  const collection = await getSharedCollection(token);
  if (!collection) {
    notFound();
  }

  // Get total count of books in collection
  const [totalResult] = await db
    .select({ count: count() })
    .from(collectionBooks)
    .where(eq(collectionBooks.collectionId, collection.id));

  const total = totalResult?.count ?? 0;

  // Get initial page of books
  const limit = 24;
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
    .limit(limit);

  // Add coverUrl to each book
  const booksWithCovers = booksList.map((book) => ({
    ...book,
    coverUrl: `/api/shared/${token}/covers/${book.id}`,
  }));

  const hasMore = total > limit;

  return (
    <SharedCollectionClient
      collection={{
        name: collection.name,
        description: collection.description,
      }}
      initialBooks={booksWithCovers}
      total={total}
      hasMore={hasMore}
      shareToken={token}
    />
  );
}
