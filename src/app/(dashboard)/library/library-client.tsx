"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookCard, type Book } from "@/components/library/BookCard";

export default function LibraryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();

  // Derived from URL
  const q = searchParams.get("q") || "";
  const type = searchParams.get("type") || "all";
  const status = searchParams.get("status") || "all";
  const sort = searchParams.get("sort") || "added";
  const page = Number(searchParams.get("page")) || 1;

  // Local search state — debounced before pushing to URL
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // Fetched data
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch whenever URL params change
  useEffect(() => {
    setLoading(true);
    fetch(`/api/books?${paramsString}`)
      .then((r) => r.json())
      .then((d) => {
        setBooks(d.books);
        setTotal(d.total);
        setTotalPages(d.totalPages);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [paramsString]);

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

      {/* Search + filter row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
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
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Type */}
        <Select
          value={type}
          onValueChange={(v) => {
            setLoading(true);
            navigate({ type: v === "all" ? "" : v });
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="epub">ePub</SelectItem>
          </SelectContent>
        </Select>

        {/* Status */}
        <Select
          value={status}
          onValueChange={(v) => {
            setLoading(true);
            navigate({ status: v === "all" ? "" : v });
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="not_started">Not Started</SelectItem>
            <SelectItem value="reading">Reading</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select
          value={sort}
          onValueChange={(v) => {
            setLoading(true);
            navigate({ sort: v === "added" ? "" : v });
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added">Recently Added</SelectItem>
            <SelectItem value="read">Recently Read</SelectItem>
            <SelectItem value="title">Title A–Z</SelectItem>
            <SelectItem value="author">Author A–Z</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground hover:text-foreground">
            Clear filters
          </Button>
        )}
      </div>

      {/* Book count */}
      {!loading && (
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "book" : "books"}
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
            <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} · {total} books
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setLoading(true);
                navigate({ page: page > 2 ? String(page - 1) : "" }, false);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                setLoading(true);
                navigate({ page: String(page + 1) }, false);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
