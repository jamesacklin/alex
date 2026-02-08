"use client";

import { useCallback, useMemo, useState } from "react";
import { PdfReader } from "@/components/readers/PdfReader";

interface PublicReaderClientProps {
  token: string;
  bookId: string;
  title: string;
  fileType: "pdf" | "epub";
  fileUrl: string;
  backUrl: string;
}

type PdfProgress = {
  currentPage: number;
  totalPages: number;
  percentComplete: number;
};

export default function PublicReaderClient({
  token,
  bookId,
  title,
  fileType,
  fileUrl,
  backUrl,
}: PublicReaderClientProps) {
  const storageKey = useMemo(
    () => `shared-progress:${token}:${bookId}`,
    [token, bookId],
  );

  const [initialPage] = useState(() => {
    if (typeof window === "undefined") return 1;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return 1;
      const parsed = JSON.parse(saved) as PdfProgress;
      return Number.isFinite(parsed?.currentPage) ? parsed.currentPage : 1;
    } catch {
      return 1;
    }
  });

  const handlePageChange = useCallback(
    (currentPage: number, totalPages: number) => {
      const percentComplete =
        totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
      const progress: PdfProgress = {
        currentPage,
        totalPages,
        percentComplete,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(progress));
      } catch {
        // ignore write failures (private mode, quota, etc.)
      }
    },
    [storageKey],
  );

  if (fileType !== "pdf") {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        ePub reader coming soon…
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <PdfReader
        bookId={bookId}
        title={title}
        fileUrl={fileUrl}
        backUrl={backUrl}
        initialPage={initialPage}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
