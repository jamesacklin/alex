"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookCard, type Book } from "@/components/library/BookCard";
import { BookFilters } from "@/components/library/BookFilters";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  fetchJsonOrThrow,
  getRequestErrorPresentation,
  isAbortError,
} from "@/lib/client/request-error";

interface CachedLibraryQueryResult {
  books: Book[];
  total: number;
  hasMore: boolean;
}

interface LibraryBooksResponse {
  books?: Book[];
  total?: number;
  hasMore?: boolean;
}

interface NowReadingResponse {
  books?: Book[];
}

const libraryQueryCache = new Map<string, CachedLibraryQueryResult>();
let nowReadingCache: Book[] = [];

function createLibraryCacheKey(
  q: string,
  type: string,
  status: string,
  sort: string,
) {
  return JSON.stringify({ q, type, status, sort });
}

function showLibraryErrorToast(error: unknown, toastId: string, actionLabel: string) {
  const presentation = getRequestErrorPresentation(error, {
    resourceLabel: "library data",
    actionLabel,
  });
  toast.error(presentation.title, {
    id: toastId,
    description: presentation.description,
  });
}

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
  const libraryCacheKey = createLibraryCacheKey(q, type, status, sort);
  const cachedLibraryState = libraryQueryCache.get(libraryCacheKey);

  // Fetched data
  const [books, setBooks] = useState<Book[]>(cachedLibraryState?.books ?? []);
  const [nowReadingBooks, setNowReadingBooks] = useState<Book[]>(
    nowReadingCache,
  );
  const [total, setTotal] = useState(cachedLibraryState?.total ?? 0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(cachedLibraryState?.hasMore ?? true);
  const [loading, setLoading] = useState(!cachedLibraryState);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep searchParams in a ref to access current value without triggering effects
  const searchParamsRef = useRef(searchParams);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  // Fetch "Now Reading" books separately
  useEffect(() => {
    let isCancelled = false;

    const fetchNowReading = async () => {
      try {
        const data = await fetchJsonOrThrow<NowReadingResponse>(
          "/api/books/now-reading",
        );
        if (isCancelled) return;
        if (data.books) {
          nowReadingCache = data.books;
          setNowReadingBooks(data.books);
        }
      } catch (err) {
        if (isCancelled || isAbortError(err)) return;
        console.error("Failed to fetch now reading books:", err);
        showLibraryErrorToast(err, "library-now-reading-error", "load now reading books");
      }
    };

    void fetchNowReading();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Fetch initial page or when filters change
  useEffect(() => {
    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const cachedResult = libraryQueryCache.get(libraryCacheKey);
    if (cachedResult) {
      setBooks(cachedResult.books);
      setTotal(cachedResult.total);
      setHasMore(cachedResult.hasMore);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const fetchInitialBooks = async () => {
      setCurrentPage(1);

      try {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page"); // Always start from page 1 on filter change

        const data = await fetchJsonOrThrow<LibraryBooksResponse>(`/api/books?${params}`, {
          signal: controller.signal,
        });

        setBooks(data.books ?? []);
        setTotal(data.total ?? 0);
        setHasMore(Boolean(data.hasMore));
        setLoading(false);
        libraryQueryCache.set(libraryCacheKey, {
          books: data.books ?? [],
          total: data.total ?? 0,
          hasMore: Boolean(data.hasMore),
        });
      } catch (error) {
        if (isAbortError(error)) return;
        setLoading(false);
        console.error("Failed to fetch library books:", error);
        showLibraryErrorToast(error, "library-books-error", "load library books");
      }
    };

    fetchInitialBooks();

    return () => {
      controller.abort();
    };
    // Only re-fetch when filter params change, not page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, status, sort, libraryCacheKey]);

  // Real-time updates: listen to watcher events via SSE
  useEffect(() => {
    const eventSource = new EventSource("/api/library/events");

    eventSource.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);

        // Auto-refresh library when watcher detects changes
        if (data.type === "library-update") {
          // Show toast notification
          toast.info("Library updated", {
            description: "Refreshing your library...",
          });

          // Reset to initial state and re-fetch
          setCurrentPage(1);
          setLoading(true);

          const params = new URLSearchParams(searchParams.toString());
          params.delete("page");

          const refreshLibrary = async () => {
            try {
              const d = await fetchJsonOrThrow<LibraryBooksResponse>(`/api/books?${params}`);
              setBooks(d.books ?? []);
              setTotal(d.total ?? 0);
              setHasMore(Boolean(d.hasMore));
              setLoading(false);
              libraryQueryCache.set(libraryCacheKey, {
                books: d.books ?? [],
                total: d.total ?? 0,
                hasMore: Boolean(d.hasMore),
              });
            } catch (error) {
              console.error("Failed to refresh library books:", error);
              setLoading(false);
              showLibraryErrorToast(error, "library-refresh-error", "refresh library books");
            }
          };

          void refreshLibrary();

          // Also refresh now reading section
          const refreshNowReading = async () => {
            try {
              const refreshData = await fetchJsonOrThrow<NowReadingResponse>(
                "/api/books/now-reading",
              );
              if (refreshData.books) {
                nowReadingCache = refreshData.books;
                setNowReadingBooks(refreshData.books);
              }
            } catch (err) {
              console.error("Failed to fetch now reading books:", err);
              showLibraryErrorToast(
                err,
                "library-now-reading-refresh-error",
                "refresh now reading books",
              );
            }
          };

          void refreshNowReading();
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
  }, [libraryCacheKey, searchParams]);


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

  // Update URL page param as user loads more (debounced 500ms)
  useEffect(() => {
    if (currentPage === 1) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      params.set("page", String(currentPage));
      router.replace(`/library?${params}`, { scroll: false });
    }, 500);
    return () => clearTimeout(timer);
  }, [currentPage, router]);

  // Load more handler
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore || loading) return;

    setIsLoadingMore(true);
    const nextPage = currentPage + 1;

    try {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));

      const data = await fetchJsonOrThrow<LibraryBooksResponse>(`/api/books?${params}`);

      // Only update if we got new books
      if (data.books && data.books.length > 0) {
        const nextPageBooks = data.books;
        setBooks((prev) => {
          const nextBooks = [...prev, ...nextPageBooks];
          libraryQueryCache.set(libraryCacheKey, {
            books: nextBooks,
            total: data.total ?? 0,
            hasMore: Boolean(data.hasMore),
          });
          return nextBooks;
        });
        setCurrentPage(nextPage);
        setHasMore(Boolean(data.hasMore));
        setTotal(data.total ?? 0);
      } else {
        // No more books to load
        setHasMore(false);
        setBooks((prev) => {
          libraryQueryCache.set(libraryCacheKey, {
            books: prev,
            total,
            hasMore: false,
          });
          return prev;
        });
      }
    } catch (error) {
      console.error("Failed to load more books:", error);
      showLibraryErrorToast(error, "library-load-more-error", "load more books");
      setHasMore(false); // Stop trying on error
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
    const params = new URLSearchParams();
    if (sort !== "added") params.set("sort", sort);
    router.push(`/library${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <div className="space-y-6">
      {/* Filter pills */}
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

      {/* Grid / Skeleton / Empty */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden">
              <Skeleton className="aspect-[2/3]" />
              <div className="pt-2.5 space-y-2">
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
            aria-hidden="true"
            focusable="false"
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
          {/* Now Reading section */}
          {nowReadingBooks.length > 0 && (
            <>
              <div className="space-y-5">
                <h2 className="text-base font-medium">Now Reading</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                  {nowReadingBooks.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </div>
              <hr className="border-border" />
            </>
          )}

          {/* All Books section */}
          {(() => {
            const nowReadingIds = new Set(nowReadingBooks.map((book) => book.id));
            const otherBooks = books.filter((book) => !nowReadingIds.has(book.id));

            if (otherBooks.length === 0 && books.length > 0) {
              // All loaded books are in "Now Reading", but there might be more to load
              return null;
            }

            return (
              <>
                {otherBooks.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2">
                      <h2 className="text-base font-medium">All Books</h2>
                      {!loading && (
                        <p className="text-sm text-muted-foreground text-end">
                          Showing {books.length} of {total}{" "}
                          {total === 1 ? "book" : "books"}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                      {otherBooks.map((book) => (
                        <BookCard key={book.id} book={book} />
                      ))}
                    </div>
                  </>
                )}

                {/* Infinite scroll sentinel */}
                {hasMore && <div ref={sentinelRef} className="h-20" />}
              </>
            );
          })()}

          {/* Loading more skeletons */}
          {isLoadingMore && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="overflow-hidden">
                  <Skeleton className="aspect-[2/3]" />
                  <div className="pt-2.5 space-y-2">
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
