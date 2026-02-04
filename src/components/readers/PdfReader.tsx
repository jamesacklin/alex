"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfToolbar } from "./PdfToolbar";

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
  title: string;
  initialPage: number;
  onPageChange: (currentPage: number, totalPages: number) => void;
}

export function PdfReader({ bookId, title, initialPage, onPageChange }: PdfReaderProps) {
  // --- Page state ---
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [error, setError] = useState<string | null>(null);

  // --- Container dimensions ---
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      setContainerWidth(node.clientWidth);
      setContainerHeight(node.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // --- PDF document proxy + natural page dimensions ---
  const docProxyRef = useRef<any>(null);
  const [docReady, setDocReady] = useState(0); // bumped in onLoadSuccess so effects that need the proxy re-run
  const [pageNaturalWidth, setPageNaturalWidth] = useState<number | null>(null);
  const [pageNaturalHeight, setPageNaturalHeight] = useState<number | null>(null);

  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    if (!docProxyRef.current) return;
    docProxyRef.current.getPage(currentPage).then((page: any) => {
      const vp = page.getViewport({ scale: 1 });
      setPageNaturalWidth(vp.width);
      setPageNaturalHeight(vp.height);
    });
  }, [currentPage, docReady]);

  // --- Zoom ---
  const [zoomPercent, setZoomPercent] = useState<number>(() => {
    if (typeof window === "undefined") return 100;
    const stored = localStorage.getItem("pdf-zoom");
    return stored ? Math.min(200, Math.max(50, Number(stored))) : 100;
  });
  useEffect(() => {
    localStorage.setItem("pdf-zoom", String(zoomPercent));
  }, [zoomPercent]);

  const effectiveWidth = containerWidth ? containerWidth * (zoomPercent / 100) : undefined;

  const zoomIn = () => setZoomPercent((z) => Math.min(200, z + 25));
  const zoomOut = () => setZoomPercent((z) => Math.max(50, z - 25));
  const fitWidth = () => setZoomPercent(100);
  const fitPage = () => {
    if (!containerWidth || !containerHeight || !pageNaturalWidth || !pageNaturalHeight) return;
    const z = Math.round((containerHeight * pageNaturalWidth) / (containerWidth * pageNaturalHeight) * 100);
    setZoomPercent(Math.min(200, Math.max(50, Math.min(100, z))));
  };

  // --- Progress ---
  useEffect(() => {
    if (numPages && currentPage >= 1) {
      onPageChange(currentPage, numPages);
    }
  }, [currentPage, numPages, onPageChange]);

  // --- Page navigation ---
  const pageInputRef = useRef<HTMLInputElement>(null);
  const goTo = (page: number) => {
    if (numPages && page >= 1 && page <= numPages) {
      setError(null);
      setCurrentPage(page);
    }
  };

  // --- Search ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Extract text strings from current page for search
  const [pageTextItems, setPageTextItems] = useState<string[]>([]);
  useEffect(() => {
    if (!docProxyRef.current) { setPageTextItems([]); return; }
    docProxyRef.current.getPage(currentPage).then((page: any) =>
      page.getTextContent().then((content: any) => {
        setPageTextItems(content.items.map((item: any) => item.str));
      })
    );
  }, [currentPage, docReady]);

  // Reset match index when query or page changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, currentPage]);

  // Focus search input when panel opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Compute matches + per-item highlight ranges (pure, no async)
  const { matchCount, highlightMap } = useMemo(() => {
    if (!searchQuery.trim() || pageTextItems.length === 0) {
      return { matchCount: 0, highlightMap: new Map<number, Array<[number, number, boolean]>>() };
    }

    const fullText = pageTextItems.join("");
    const lowerFull = fullText.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();

    // All match positions in the concatenated text
    const positions: [number, number][] = [];
    let pos = 0;
    while (true) {
      const idx = lowerFull.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      positions.push([idx, idx + lowerQuery.length]);
      pos = idx + 1;
    }
    if (positions.length === 0) return { matchCount: 0, highlightMap: new Map() };

    // Item boundaries in the concatenated string
    const boundaries = [0];
    pageTextItems.forEach((str) => boundaries.push(boundaries[boundaries.length - 1] + str.length));

    // Map each match back to the item indices it touches
    const map = new Map<number, Array<[number, number, boolean]>>();
    positions.forEach(([gStart, gEnd], matchIdx) => {
      const isActive = matchIdx === currentMatchIndex % positions.length;
      for (let i = 0; i < pageTextItems.length; i++) {
        const itemStart = boundaries[i];
        const itemEnd = boundaries[i + 1];
        if (gEnd <= itemStart) break;
        if (gStart >= itemEnd) continue;
        const localStart = Math.max(0, gStart - itemStart);
        const localEnd = Math.min(pageTextItems[i].length, gEnd - itemStart);
        if (!map.has(i)) map.set(i, []);
        map.get(i)!.push([localStart, localEnd, isActive]);
      }
    });

    return { matchCount: positions.length, highlightMap: map };
  }, [pageTextItems, searchQuery, currentMatchIndex]);

  // Custom text renderer — returns HTML string; matched regions wrapped in <mark>
  const customTextRenderer = useCallback(({ str, itemIndex }: { str: string; itemIndex: number }) => {
    const ranges = highlightMap.get(itemIndex);
    if (!ranges || ranges.length === 0) return str;

    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    let html = "";
    let cursor = 0;
    sorted.forEach(([start, end, isActive]) => {
      if (cursor < start) html += str.slice(cursor, start);
      const bg = isActive ? "#f97316" : "#fde047";
      html += `<mark style="background-color:${bg};color:#000;border-radius:2px">${str.slice(start, end)}</mark>`;
      cursor = end;
    });
    if (cursor < str.length) html += str.slice(cursor);
    return html;
  }, [highlightMap]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+F always opens search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // All other shortcuts skip while any input is focused
      if (document.activeElement === pageInputRef.current || document.activeElement === searchInputRef.current) return;
      switch (e.key) {
        case "ArrowLeft":
          if (numPages) { e.preventDefault(); goTo(currentPage - 1); }
          break;
        case "ArrowRight":
          if (numPages) { e.preventDefault(); goTo(currentPage + 1); }
          break;
        case "Home":
          if (numPages) { e.preventDefault(); goTo(1); }
          break;
        case "End":
          if (numPages) { e.preventDefault(); goTo(numPages); }
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
          e.preventDefault();
          zoomOut();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPage, numPages, zoomPercent]);

  // --- Render ---
  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Toolbar */}
      {numPages && (
        <PdfToolbar
          title={title}
          currentPage={currentPage}
          numPages={numPages}
          zoomPercent={zoomPercent}
          onPrevPage={() => goTo(currentPage - 1)}
          onNextPage={() => goTo(currentPage + 1)}
          onGoToPage={goTo}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFitWidth={fitWidth}
          onFitPage={fitPage}
          onSearchToggle={() => setSearchOpen((o) => !o)}
          pageInputRef={pageInputRef}
        />
      )}

      {/* Search panel */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matchCount > 0) setCurrentMatchIndex((prev) => (prev + 1) % matchCount);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Search in document…"
            className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <span className="text-gray-400 text-xs whitespace-nowrap select-none">
            {matchCount > 0 ? `${(currentMatchIndex % matchCount) + 1} of ${matchCount}` : "No matches"}
          </span>
          <button
            className="text-gray-300 hover:text-white disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount)}
            aria-label="Previous match"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            className="text-gray-300 hover:text-white disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setCurrentMatchIndex((prev) => (prev + 1) % matchCount)}
            aria-label="Next match"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <button
            className="text-gray-400 hover:text-white"
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
            aria-label="Close search"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

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
            onLoadSuccess={(doc) => {
              setNumPages(doc.numPages);
              setCurrentPage((prev) => Math.min(prev, doc.numPages));
              docProxyRef.current = doc;
              setDocReady((n) => n + 1);
              doc.getPage(Math.min(initialPage, doc.numPages)).then((page: any) => {
                const vp = page.getViewport({ scale: 1 });
                setPageNaturalWidth(vp.width);
                setPageNaturalHeight(vp.height);
              });
            }}
            onLoadError={() => setError("Failed to load PDF.")}
            loading={<Spinner />}
          >
            {numPages && (
              <Page
                pageNumber={currentPage}
                width={effectiveWidth}
                loading={<Spinner />}
                onError={() => setError("Failed to render this page.")}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                customTextRenderer={customTextRenderer as any}
              />
            )}
          </Document>
        )}
      </div>

    </div>
  );
}
