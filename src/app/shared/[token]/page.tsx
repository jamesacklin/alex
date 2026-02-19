import { notFound } from "next/navigation";
import { getSharedCollection } from "@/lib/shared";
import { queryAll, queryOne } from "@/lib/db/rust";
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
  const totalResult = await queryOne<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM collection_books
      WHERE collection_id = ?1
    `,
    [collection.id]
  );

  const total = Number(totalResult?.count ?? 0);

  // Get initial page of books
  const limit = 24;
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
    `,
    [collection.id, limit]
  );

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
