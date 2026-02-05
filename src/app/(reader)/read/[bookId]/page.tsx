"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const PdfReader = dynamic(() => import("@/components/readers/PdfReader").then((m) => m.PdfReader), { ssr: false });

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
    <div className="flex-1 min-h-0 overflow-hidden">
      <PdfReader
        bookId={book.id}
        title={book.title}
        initialPage={savedProgress?.currentPage ?? 1}
        onPageChange={saveProgress}
      />
    </div>
  );
}
