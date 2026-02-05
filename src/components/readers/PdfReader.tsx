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
  const [zoomPercent, setZoomPercent] = useState(100);
  const [fitReady, setFitReady] = useState(false);
  const userZoomed = useRef(false); // set true on first manual zoom; stops auto-fit

  // In auto-fit mode compute width directly from dimensions (single render, no flicker).
  // Once the user zooms manually, fall back to zoomPercent-based width.
  const effectiveWidth = useMemo(() => {
    if (!containerWidth) return undefined;
    if (!userZoomed.current && containerHeight && pageNaturalWidth && pageNaturalHeight) {
      const availW = containerWidth - 32;
      const availH = containerHeight - 32;
      return Math.min(availW, availH * pageNaturalWidth / pageNaturalHeight);
    }
    return containerWidth * (zoomPercent / 100);
  }, [containerWidth, containerHeight, pageNaturalWidth, pageNaturalHeight, zoomPercent]);

  const zoomIn = () => { userZoomed.current = true; setZoomPercent((z) => Math.min(200, z + 25)); };
  const zoomOut = () => { userZoomed.current = true; setZoomPercent((z) => Math.max(50, z - 25)); };
  const fit = () => {
    if (!containerWidth || !containerHeight || !pageNaturalWidth || !pageNaturalHeight) return;
    const availW = containerWidth - 32; // p-4 padding each side
    const availH = containerHeight - 32;
    const fitW = (availW / containerWidth) * 100;
    const fitH = (availH * pageNaturalWidth) / (pageNaturalHeight * containerWidth) * 100;
    setZoomPercent(Math.min(200, Math.max(50, Math.floor(Math.min(fitW, fitH)))));
  };

  // Auto-fit: keeps page fitted as dimensions settle (toolbar appearing, etc.)
  // until the user manually zooms. fitReady gates the <Page> render so it never
  // paints before the first fit calculation.
  useEffect(() => {
    if (userZoomed.current) return;
    if (!containerWidth || !containerHeight || !pageNaturalWidth || !pageNaturalHeight) return;
    fit();
    if (!fitReady) setFitReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth, containerHeight, pageNaturalWidth, pageNaturalHeight]);

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

  // All pages text — lazy-loaded on first search open, cached until doc changes
  const [allPagesText, setAllPagesText] = useState<string[][] | null>(null);
  useEffect(() => { setAllPagesText(null); }, [docReady]);
  useEffect(() => {
    if (!searchOpen || allPagesText !== null || !docProxyRef.current) return;
    const doc = docProxyRef.current;
    const promises: Promise<string[]>[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      promises.push(
        doc.getPage(i).then((page: any) => page.getTextContent()).then((content: any) =>
          content.items.map((item: any) => item.str)
        )
      );
    }
    Promise.all(promises).then((texts) => setAllPagesText(texts));
  }, [searchOpen, docReady, allPagesText]);

  // Reset match index when query changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  // Focus search input when panel opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Global matches across all pages in document order
  const globalMatches = useMemo(() => {
    if (!searchQuery.trim() || !allPagesText) return [];
    const lowerQuery = searchQuery.toLowerCase();
    const matches: { page: number; start: number; end: number }[] = [];
    allPagesText.forEach((pageItems, pageIdx) => {
      const fullText = pageItems.join("");
      const lowerFull = fullText.toLowerCase();
      let pos = 0;
      while (true) {
        const idx = lowerFull.indexOf(lowerQuery, pos);
        if (idx === -1) break;
        matches.push({ page: pageIdx + 1, start: idx, end: idx + lowerQuery.length });
        pos = idx + 1;
      }
    });
    return matches;
  }, [allPagesText, searchQuery]);

  const matchCount = globalMatches.length;

  // Navigate to the active match's page when the index or match list changes.
  // currentPage is intentionally excluded — we only want to react to match navigation,
  // not to the user manually changing pages via arrows/input.
  useEffect(() => {
    if (globalMatches.length === 0) return;
    const match = globalMatches[currentMatchIndex % globalMatches.length];
    if (match.page !== currentPage) {
      setCurrentPage(match.page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchIndex, globalMatches]);

  // Highlight map for the page currently being rendered
  const highlightMap = useMemo(() => {
    if (!allPagesText || globalMatches.length === 0) return new Map<number, Array<[number, number, boolean]>>();
    const pageItems = allPagesText[currentPage - 1];
    if (!pageItems) return new Map();

    const activeIdx = currentMatchIndex % globalMatches.length;
    const boundaries = [0];
    pageItems.forEach((str) => boundaries.push(boundaries[boundaries.length - 1] + str.length));

    const map = new Map<number, Array<[number, number, boolean]>>();
    globalMatches.forEach((match, globalIdx) => {
      if (match.page !== currentPage) return;
      const isActive = globalIdx === activeIdx;
      for (let i = 0; i < pageItems.length; i++) {
        const itemStart = boundaries[i];
        const itemEnd = boundaries[i + 1];
        if (match.end <= itemStart) break;
        if (match.start >= itemEnd) continue;
        const localStart = Math.max(0, match.start - itemStart);
        const localEnd = Math.min(pageItems[i].length, match.end - itemStart);
        if (!map.has(i)) map.set(i, []);
        map.get(i)!.push([localStart, localEnd, isActive]);
      }
    });

    return map;
  }, [allPagesText, globalMatches, currentPage, currentMatchIndex]);

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
          onFit={() => { userZoomed.current = true; fit(); }}
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
            {numPages && fitReady && (
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
