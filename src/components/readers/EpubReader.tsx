"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";

interface EpubReaderProps {
  bookId: string;
  title: string;
  initialLocation?: string;
  onLocationChange: (epubLocation: string, percentComplete: number) => void;
}

export function EpubReader({ bookId, title, initialLocation, onLocationChange }: EpubReaderProps) {
  const [location, setLocation] = useState<string | number>(initialLocation ?? 0);
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);

  // Fetch the epub file as ArrayBuffer on mount
  useEffect(() => {
    fetch(`/api/books/${bookId}/file`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch ePub file");
        return r.arrayBuffer();
      })
      .then((buffer) => setEpubData(buffer))
      .catch((err) => {
        console.error("ePub fetch error:", err);
        setError("Failed to load ePub file");
        setLoading(false);
      });
  }, [bookId]);

  const handleLocationChanged = useCallback(
    (epubcfi: string) => {
      setLocation(epubcfi);
      setLoading(false);

      if (!renditionRef.current) return;

      const book = renditionRef.current.book;
      // Only save progress if locations are ready (for percentage calculation)
      if (book.locations.length() > 0) {
        const percent = book.locations.percentageFromCfi(epubcfi) * 100;
        onLocationChange(epubcfi, percent);
      }
    },
    [onLocationChange],
  );

  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Hook error listener for book load failures
    rendition.book.on("openFailed", (err: unknown) => {
      console.error("ePub load error:", err);
      setError("Failed to load ePub file");
      setLoading(false);
    });

    // Generate location spine for percentage tracking
    rendition.book.ready
      .then(() => rendition.book.locations.generate(1024))
      .catch((err: unknown) => {
        console.error("Failed to generate locations:", err);
        // Don't block the reader — percentage tracking just won't work
      });
  }, []);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col h-full bg-background">
        <header className="flex items-center gap-3 px-4 h-12 bg-gray-900 text-white shrink-0">
          <Link href="/library" className="p-1 rounded hover:bg-gray-800 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-sm font-medium truncate">{title}</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <p>{error}</p>
          <Link href="/library" className="text-sm text-primary hover:underline">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 h-12 bg-gray-900 text-white shrink-0">
        <Link href="/library" className="p-1 rounded hover:bg-gray-800 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-sm font-medium truncate">{title}</h1>
      </header>

      {/* Reader */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading ePub…</p>
            </div>
          </div>
        )}
        {epubData && (
          <ReactReader
            url={epubData as any}
            location={location}
            locationChanged={handleLocationChanged}
            getRendition={handleGetRendition}
          />
        )}
      </div>
    </div>
  );
}
