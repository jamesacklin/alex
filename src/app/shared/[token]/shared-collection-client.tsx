"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SharedBookCard, type SharedBook } from "@/components/library/SharedBookCard";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

interface SharedCollectionClientProps {
  collection: {
    name: string;
    description: string | null;
  };
  initialBooks: SharedBook[];
  total: number;
  hasMore: boolean;
  shareToken: string;
}

export default function SharedCollectionClient({
  collection,
  initialBooks,
  total,
  hasMore: initialHasMore,
  shareToken,
}: SharedCollectionClientProps) {
  const [books, setBooks] = useState<SharedBook[]>(initialBooks);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load more handler
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    setError(null);
    const nextPage = currentPage + 1;

    try {
      const response = await fetch(
        `/api/shared/${shareToken}?page=${nextPage}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "This collection is no longer available or sharing has been disabled."
          );
        }
        throw new Error("Failed to load more books. Please try again.");
      }

      const data = await response.json();

      setBooks((prev) => [...prev, ...data.books]);
      setCurrentPage(nextPage);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load collection. Please try again."
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Retry after error
  const handleRetry = () => {
    setError(null);
    handleLoadMore();
  };

  // Infinite scroll hook
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: handleLoadMore,
    hasMore,
    isLoading: isLoadingMore,
    threshold: 400,
    enabled: true,
  });

  return (
    <div className="space-y-6">
      {/* Collection metadata */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <h1 className="text-lg font-medium tracking-tight flex-1">{collection.name}</h1>
          <Badge variant="secondary" className="text-sm">
            Shared Collection
          </Badge>
        </div>
        {collection.description && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {collection.description}
          </p>
        )}
      </div>

      {/* Book count */}
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? "No books in this collection"
          : `Showing ${books.length} of ${total} ${total === 1 ? "book" : "books"}`}
      </p>

      {/* Empty state */}
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="h-12 w-12 text-muted-foreground mb-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <p className="text-muted-foreground font-medium">
            This collection is empty
          </p>
        </div>
      ) : (
        <>
          {/* Books grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 lg:gap-6">
            {books.map((book) => (
              <SharedBookCard
                key={book.id}
                book={book}
                shareToken={shareToken}
              />
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-20" />

          {/* Loading more skeletons */}
          {isLoadingMore && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 lg:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-lg border overflow-hidden">
                  <Skeleton className="aspect-[2/3]" />
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="max-w-md space-y-4">
                <svg
                  className="h-12 w-12 text-destructive mx-auto"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-destructive font-medium">{error}</p>
                <Button onClick={handleRetry} variant="outline">
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Load More button */}
          {hasMore && !isLoadingMore && !error && (
            <div className="flex justify-center pt-6">
              <Button onClick={handleLoadMore} variant="outline" size="lg">
                Load More Books
              </Button>
            </div>
          )}

          {/* All loaded message */}
          {!hasMore && books.length > 0 && (
            <div className="flex justify-center pt-6">
              <p className="text-sm text-muted-foreground">
                All books loaded ({total} total)
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
