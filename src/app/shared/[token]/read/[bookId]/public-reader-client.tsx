"use client";

import { useCallback, useMemo, useState } from "react";
import { PdfReader } from "@/components/readers/PdfReader";
import { EpubReader } from "@/components/readers/EpubReader";

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
type EpubProgress = {
  epubLocation: string;
  percentComplete: number;
};

function readStoredProgress(key: string) {
  if (typeof window === "undefined") return null;
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as unknown;
  } catch {
    return null;
  }
}

function writeStoredProgress(key: string, progress: PdfProgress | EpubProgress) {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // ignore write failures (private mode, quota, etc.)
  }
}

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
    const parsed = readStoredProgress(storageKey) as PdfProgress | null;
    return Number.isFinite(parsed?.currentPage) ? parsed.currentPage : 1;
  });
  const [initialLocation] = useState(() => {
    const parsed = readStoredProgress(storageKey) as EpubProgress | null;
    return typeof parsed?.epubLocation === "string"
      ? parsed.epubLocation
      : undefined;
  });

  const handlePageChange = useCallback(
    (currentPage: number, totalPages: number) => {
      const percentComplete =
        totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
      const progress: PdfProgress = { currentPage, totalPages, percentComplete };
      writeStoredProgress(storageKey, progress);
    },
    [storageKey],
  );
  const handleLocationChange = useCallback(
    (epubLocation: string, percentComplete: number) => {
      const progress: EpubProgress = { epubLocation, percentComplete };
      writeStoredProgress(storageKey, progress);
    },
    [storageKey],
  );

  if (fileType === "epub") {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <EpubReader
          bookId={bookId}
          title={title}
          fileUrl={fileUrl}
          backUrl={backUrl}
          initialLocation={initialLocation}
          onLocationChange={handleLocationChange}
        />
      </div>
    );
  }

  if (fileType === "pdf") {
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

  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Unsupported file type.
    </div>
  );
}
