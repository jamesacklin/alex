"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCard, type Book } from "@/components/library/BookCard";
import { BookFilters } from "@/components/library/BookFilters";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

export default function LibraryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();

  // Derived from URL
  const q = searchParams.get("q") || "";
  const type = searchParams.get("type") || "all";
  const status = searchParams.get("status") || "all";
  const sort = searchParams.get("sort") || "added";
  const initialPage = Number(searchParams.get("page")) || 1;

  // Local search state — debounced before pushing to URL
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // Fetched data
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch initial page or when filters change
  useEffect(() => {
    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const fetchInitialBooks = async () => {
      setLoading(true);
      setCurrentPage(1);

      try {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page"); // Always start from page 1 on filter change

        const response = await fetch(`/api/books?${params}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        setBooks(data.books);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setLoading(false);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          setLoading(false);
        }
      }
    };

    fetchInitialBooks();

    return () => {
      controller.abort();
    };
    // Only re-fetch when filter params change, not page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, status, sort]);

  // Real-time updates: listen to watcher events via SSE
  const [libraryUpdateDetected, setLibraryUpdateDetected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource("/api/library/events");

    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);

        // Show banner instead of auto-refresh to preserve scroll position
        if (data.type === "library-update") {
          setLibraryUpdateDetected(true);
        }
      } catch {
        // Ignore parsing errors
      }
    });

    eventSource.addEventListener("error", () => {
      // EventSource will automatically reconnect
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const handleRefreshLibrary = () => {
    setLibraryUpdateDetected(false);
    // Reset to initial state and re-fetch
    setCurrentPage(1);
    setBooks([]);
    setLoading(true);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");

    fetch(`/api/books?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setBooks(d.books);
        setTotal(d.total);
        setHasMore(d.hasMore);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // Push a new set of search-param updates to the URL
  const navigate = (updates: Record<string, string>, resetPage = true) => {
    const params = new URLSearchParams(paramsString);
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (resetPage) params.delete("page");
    router.push(`/library${params.toString() ? `?${params}` : ""}`);
  };

  // Debounced search → URL (300 ms)
  useEffect(() => {
    if (searchInput === q) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(paramsString);
      if (searchInput) params.set("q", searchInput);
      else params.delete("q");
      params.delete("page");
      router.push(`/library?${params}`);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, q]);

  // Update URL page param as user loads more (debounced 500ms)
  useEffect(() => {
    if (currentPage === 1) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(currentPage));
      router.replace(`/library?${params}`, { scroll: false });
    }, 500);
    return () => clearTimeout(timer);
  }, [currentPage, router, searchParams]);

  // Load more handler
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const nextPage = currentPage + 1;

    try {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));

      const response = await fetch(`/api/books?${params}`);
      const data = await response.json();

      setBooks((prev) => [...prev, ...data.books]);
      setCurrentPage(nextPage);
      setHasMore(data.hasMore);
      setTotal(data.total);
    } catch (error) {
      console.error("Failed to load more books:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Infinite scroll hook
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: handleLoadMore,
    hasMore,
    isLoading: isLoadingMore || loading,
    threshold: 400,
    enabled: true,
  });

  // --- derived flags ---
  const hasFilters = q !== "" || type !== "all" || status !== "all";

  const clearFilters = () => {
    setSearchInput("");
    const params = new URLSearchParams();
    if (sort !== "added") params.set("sort", sort);
    router.push(`/library${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Library</h1>

      {/* Library update banner */}
      {libraryUpdateDetected && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
          <svg
            className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
          <p className="text-sm text-blue-900 dark:text-blue-100 flex-1">
            Library updated. Refresh to see changes.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefreshLibrary}
            className="border-blue-300 dark:border-blue-700"
          >
            Refresh
          </Button>
        </div>
      )}

      {/* Search + filter row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => navigate({ q: searchInput })}
            aria-label="Search"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>

          <Input
            type="text"
            placeholder="Search by title or author…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                navigate({ q: searchInput });
              }
            }}
            className="pl-9 pr-8"
          />

          {searchInput && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <BookFilters
          type={type}
          status={status}
          sort={sort}
          hasFilters={hasFilters}
          onTypeChange={(v) => {
            setLoading(true);
            navigate({ type: v === "all" ? "" : v });
          }}
          onStatusChange={(v) => {
            setLoading(true);
            navigate({ status: v === "all" ? "" : v });
          }}
          onSortChange={(v) => {
            setLoading(true);
            navigate({ sort: v === "added" ? "" : v });
          }}
          onClearFilters={clearFilters}
        />
      </div>

      {/* Book count */}
      {!loading && (
        <p className="text-sm text-muted-foreground">
          Showing {books.length} of {total} {total === 1 ? "book" : "books"}
        </p>
      )}

      {/* Grid / Skeleton / Empty */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border overflow-hidden">
              <Skeleton className="aspect-[2/3]" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
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
          <p className="text-muted-foreground font-medium">No books found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasFilters
              ? "Try adjusting your filters."
              : "Add some books to your library to get started."}
          </p>
          {hasFilters && (
            <Button
              variant="link"
              size="sm"
              onClick={clearFilters}
              className="mt-2"
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-20" />

          {/* Loading more skeletons */}
          {isLoadingMore && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
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

          {/* Load More button */}
          {hasMore && !loading && (
            <div className="flex justify-center pt-6">
              <Button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                variant="outline"
                size="lg"
              >
                {isLoadingMore
                  ? "Loading..."
                  : `Load More Books (${books.length} of ${total})`}
              </Button>
            </div>
          )}

          {/* All loaded message */}
          {!hasMore && books.length > 0 && !loading && (
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
