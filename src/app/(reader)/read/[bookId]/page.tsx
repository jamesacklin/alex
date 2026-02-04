"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PdfReader } from "@/components/readers/PdfReader";

interface BookMeta {
  id: string;
  title: string;
  fileType: string;
}

interface Progress {
  currentPage: number;
  totalPages: number;
  percentComplete: number;
  status: string;
}

export default function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const router = useRouter();
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<BookMeta | null>(null);
  const [savedProgress, setSavedProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve async params then fetch metadata + progress
  useEffect(() => {
    let cancelled = false;
    params.then(({ bookId: id }) => {
      if (cancelled) return;
      setBookId(id);
      return Promise.all([
        fetch(`/api/books/${id}`).then((r) => r.json()),
        fetch(`/api/books/${id}/progress`).then((r) => r.json()),
      ]).then(([meta, progress]) => {
        if (cancelled) return;
        if (meta.error) {
          setError(meta.error);
          setLoading(false);
          return;
        }
        if (meta.fileType !== "pdf") {
          router.replace("/library");
          return;
        }
        setBook(meta);
        setSavedProgress(progress);
        setLoading(false);
      });
    }).catch(() => {
      if (!cancelled) {
        setError("Failed to load book.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProgress = useCallback(
    (currentPage: number, totalPages: number) => {
      if (!bookId) return;
      fetch(`/api/books/${bookId}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPage, totalPages }),
      });
    },
    [bookId],
  );

  // --- Loading / Error states ---
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-muted-foreground">{error || "Book not found."}</p>
        <Link href="/library" className="text-sm text-primary hover:underline">
          Back to library
        </Link>
      </div>
    );
  }

  // --- Reader ---
  return (
    <>
      {/* Minimal header */}
      <header className="flex items-center gap-3 px-4 h-12 shrink-0 border-b bg-card">
        <Link
          href="/library"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to library"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-sm font-medium truncate">{book.title}</h1>
      </header>

      {/* PDF viewer fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PdfReader
          bookId={book.id}
          initialPage={savedProgress?.currentPage ?? 1}
          onPageChange={saveProgress}
        />
      </div>
    </>
  );
}
