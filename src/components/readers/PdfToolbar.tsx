"use client";

import Link from "next/link";

interface PdfToolbarProps {
  title: string;
  backUrl?: string;
  currentPage: number;
  numPages: number | null;
  zoomPercent: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSearchToggle: () => void;
  pageInputRef: React.RefObject<HTMLInputElement | null>;
}

export function PdfToolbar({
  title,
  backUrl,
  currentPage,
  numPages,
  zoomPercent,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onFit,
  onSearchToggle,
  pageInputRef,
}: PdfToolbarProps) {
  const hasPages = typeof numPages === "number" && numPages > 0;
  return (
    <header className="shrink-0 flex items-center px-3 h-11 bg-sidebar text-sidebar-foreground border-b border-border gap-3">
      {/* Left: back + title */}
      <Link
        href={backUrl ?? "/library"}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Back"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
        </svg>
      </Link>
      <h1 className="text-sm text-foreground font-medium truncate max-w-[160px] sm:max-w-[280px]">{title}</h1>

      {/* Center: page navigation */}
      <div className="flex items-center gap-2 mx-auto">
        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={!hasPages || currentPage <= 1}
          onClick={onPrevPage}
          aria-label="Previous page"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <span className="text-muted-foreground text-sm select-none flex items-center gap-1">
          <input
            ref={pageInputRef}
            type="number"
            min={1}
            max={hasPages ? numPages : undefined}
            value={currentPage}
            disabled={!hasPages}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v)) onGoToPage(v);
            }}
            className="w-10 text-center bg-background text-foreground border border-input rounded px-1 py-0.5 text-sm"
          />
          <span className="text-muted-foreground">/</span>
          <span>{hasPages ? numPages : "—"}</span>
        </span>

        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={!hasPages || currentPage >= numPages}
          onClick={onNextPage}
          aria-label="Next page"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Right: zoom + search — hidden on very small screens */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <span className="w-px h-5 bg-border" />

        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={zoomPercent <= 50}
          onClick={onZoomOut}
          aria-label="Zoom out"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M8 11h6" />
          </svg>
        </button>

        <span className="text-muted-foreground text-sm w-12 text-center select-none">{zoomPercent}%</span>

        <button
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={zoomPercent >= 200}
          onClick={onZoomIn}
          aria-label="Zoom in"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><path d="M11 8v6" /><path d="M8 11h6" />
          </svg>
        </button>

        <button
          className="text-muted-foreground hover:text-foreground text-sm px-1.5 py-0.5 rounded hover:bg-muted"
          onClick={onFit}
          aria-label="Fit page"
        >
          Fit
        </button>

        <span className="w-px h-5 bg-border" />

        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={onSearchToggle}
          aria-label="Search"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </div>
    </header>
  );
}
