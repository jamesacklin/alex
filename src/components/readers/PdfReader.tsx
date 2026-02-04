"use client";

import { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <svg className="h-8 w-8 animate-spin text-gray-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </div>
  );
}

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfReaderProps {
  bookId: string;
  initialPage: number;
  onPageChange: (currentPage: number, totalPages: number) => void;
}

export function PdfReader({ bookId, initialPage, onPageChange }: PdfReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync initial page once (e.g. restored from saved progress)
  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  // Measure container width for fit-width scaling
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setContainerWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Save progress whenever page changes (after initial mount)
  useEffect(() => {
    if (numPages && currentPage >= 1) {
      onPageChange(currentPage, numPages);
    }
  }, [currentPage, numPages, onPageChange]);

  const goTo = (page: number) => {
    if (numPages && page >= 1 && page <= numPages) {
      setError(null);
      setCurrentPage(page);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Page viewer */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4"
      >
        {error ? (
          <div className="flex items-center justify-center h-full text-red-400">
            {error}
          </div>
        ) : (
          <Document
            file={`/api/books/${bookId}/file`}
            onLoadSuccess={({ numPages: n }) => {
                setNumPages(n);
                setCurrentPage((prev) => Math.min(prev, n));
              }}
            onLoadError={() => setError("Failed to load PDF.")}
            loading={<Spinner />}
          >
            {numPages && (
              <Page
                pageNumber={currentPage}
                width={containerWidth ?? undefined}
                loading={<Spinner />}
                onError={() => setError("Failed to render this page.")}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            )}
          </Document>
        )}
      </div>

      {/* Minimal navigation bar */}
      {numPages && (
        <nav className="shrink-0 flex items-center justify-center gap-3 px-4 py-2 bg-gray-800 border-t border-gray-700">
          <button
            className="text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={currentPage <= 1}
            onClick={() => goTo(currentPage - 1)}
            aria-label="Previous page"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <span className="text-gray-300 text-sm select-none">
            Page{" "}
            <input
              type="number"
              min={1}
              max={numPages}
              value={currentPage}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!isNaN(v)) goTo(v);
              }}
              className="w-10 text-center bg-gray-700 text-white rounded px-1 py-0.5 text-sm"
            />{" "}
            of {numPages}
          </span>

          <button
            className="text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={currentPage >= numPages}
            onClick={() => goTo(currentPage + 1)}
            aria-label="Next page"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </nav>
      )}
    </div>
  );
}
