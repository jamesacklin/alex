"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfToolbar } from "./PdfToolbar";

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <svg className="h-8 w-8 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </div>
  );
}

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfReaderProps {
  bookId: string;
  title: string;
  initialPage: number;
  fileUrl?: string;
  backUrl?: string;
  onPageChange: (currentPage: number, totalPages: number) => void;
}

export function PdfReader({ bookId, title, initialPage, fileUrl, backUrl, onPageChange }: PdfReaderProps) {
  // --- Page state ---
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // --- Container dimensions ---
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      setContainerWidth(node.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // --- PDF document proxy ---
  const docProxyRef = useRef<{ getPage: (pageNum: number) => Promise<unknown>; numPages: number } | null>(null);
  const [docReady, setDocReady] = useState(0); // bumped in onLoadSuccess so effects that need the proxy re-run
  const [pageAspectRatio, setPageAspectRatio] = useState<number | null>(null);

  const pageContainerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleRatiosRef = useRef<Map<number, number>>(new Map());
  const initialScrollDone = useRef(false);
  const restoreTargetRef = useRef<number | null>(null);
  const restoringRef = useRef(false);
  const restoreAttemptsRef = useRef(0);

  useEffect(() => {
    setCurrentPage(initialPage);
    initialScrollDone.current = false;
    restoreTargetRef.current = initialPage;
  }, [initialPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cancelRestore = () => {
      if (restoreTargetRef.current) {
        restoreTargetRef.current = null;
        restoringRef.current = false;
      }
    };
    container.addEventListener("wheel", cancelRestore, { passive: true });
    container.addEventListener("touchstart", cancelRestore, { passive: true });
    container.addEventListener("pointerdown", cancelRestore);
    return () => {
      container.removeEventListener("wheel", cancelRestore);
      container.removeEventListener("touchstart", cancelRestore);
      container.removeEventListener("pointerdown", cancelRestore);
    };
  }, []);

  // --- Zoom ---
  const [zoomPercent, setZoomPercent] = useState(100);
  const [fitReady, setFitReady] = useState(false);
  const userZoomed = useRef(false); // set true on first manual zoom; stops auto-fit

  const effectiveWidth = useMemo(() => {
    if (!containerWidth) return undefined;
    return containerWidth * (zoomPercent / 100);
  }, [containerWidth, zoomPercent]);

  const zoomIn = () => { userZoomed.current = true; setZoomPercent((z) => Math.min(200, z + 25)); };
  const zoomOut = () => { userZoomed.current = true; setZoomPercent((z) => Math.max(50, z - 25)); };
  const fit = () => {
    if (!containerWidth) return;
    const availW = containerWidth - 32; // p-4 padding each side
    const fitW = (availW / containerWidth) * 100;
    setZoomPercent(Math.min(200, Math.max(50, Math.floor(fitW))));
  };

  // Auto-fit: keeps pages fitted to width as dimensions settle (toolbar appearing, etc.)
  // until the user manually zooms. fitReady gates the <Page> render so it never
  // paints before the first fit calculation.
  useEffect(() => {
    if (!containerWidth) return;
    if (userZoomed.current) {
      if (!fitReady) setFitReady(true);
      return;
    }
    const availW = containerWidth - 32;
    const fitW = (availW / containerWidth) * 100;
    setZoomPercent(Math.min(200, Math.max(50, Math.floor(fitW))));
    if (!fitReady) setFitReady(true);
  }, [containerWidth, fitReady]);

  // --- Progress ---
  useEffect(() => {
    if (numPages && currentPage >= 1) {
      onPageChange(currentPage, numPages);
    }
  }, [currentPage, numPages, onPageChange]);

  const scrollToPage = useCallback((page: number, opts?: { behavior?: ScrollBehavior }) => {
    if (!numPages) return;
    const target = Math.min(Math.max(page, 1), numPages);
    setError(null);
    setCurrentPage(target);
    const attempt = (tries: number) => {
      const node = pageContainerRefs.current[target - 1];
      const container = containerRef.current;
      if (node && container) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const top = nodeRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({ top, behavior: opts?.behavior ?? "auto" });
        return;
      }
      if (tries < 60) {
        requestAnimationFrame(() => attempt(tries + 1));
      }
    };
    attempt(0);
  }, [numPages]);

  useEffect(() => {
    if (!numPages) return;
    const container = containerRef.current;
    if (!container) return;
    observerRef.current?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        const ratios = visibleRatiosRef.current;
        entries.forEach((entry) => {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!pageNumber) return;
          ratios.set(pageNumber, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        if (restoreTargetRef.current) {
          return;
        }
        let bestPage = 0;
        let bestRatio = 0;
        ratios.forEach((ratio, pageNumber) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = pageNumber;
          }
        });
        if (bestPage > 0) {
          setCurrentPage((prev) => (prev === bestPage ? prev : bestPage));
        }
      },
      {
        root: container,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    observerRef.current = observer;
    pageContainerRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [numPages]);

  useEffect(() => {
    if (!numPages || !fitReady) return;
    if (initialScrollDone.current) return;
    initialScrollDone.current = true;
    const target = restoreTargetRef.current ?? initialPage;
    if (!target) return;
    scrollToPage(target, { behavior: "auto" });
  }, [numPages, fitReady, initialPage, scrollToPage]);

  useEffect(() => {
    if (!numPages || !fitReady) return;
    const target = restoreTargetRef.current;
    if (!target) return;
    restoringRef.current = true;
    restoreAttemptsRef.current = 0;
    const tick = () => {
      const activeTarget = restoreTargetRef.current;
      const container = containerRef.current;
      if (!activeTarget || !container) {
        restoringRef.current = false;
        return;
      }
      const node = pageContainerRefs.current[activeTarget - 1];
      if (node) {
        const containerRect = container.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const desiredTop = nodeRect.top - containerRect.top + container.scrollTop;
        const delta = Math.abs(desiredTop - container.scrollTop);
        if (delta <= 2) {
          restoreTargetRef.current = null;
          restoringRef.current = false;
          return;
        }
        container.scrollTo({ top: desiredTop, behavior: "auto" });
      }
      restoreAttemptsRef.current += 1;
      if (restoreAttemptsRef.current < 240) {
        requestAnimationFrame(tick);
      } else {
        restoreTargetRef.current = null;
        restoringRef.current = false;
      }
    };
    requestAnimationFrame(tick);
  }, [numPages, fitReady, effectiveWidth, initialPage, docReady]);

  const setPageRef = useCallback((pageIndex: number) => (node: HTMLDivElement | null) => {
    const prev = pageContainerRefs.current[pageIndex];
    if (prev && observerRef.current) {
      observerRef.current.unobserve(prev);
    }
    pageContainerRefs.current[pageIndex] = node;
    if (node && observerRef.current) {
      observerRef.current.observe(node);
    }
  }, []);

  // --- Page navigation ---
  const pageInputRef = useRef<HTMLInputElement>(null);
  const goTo = useCallback((page: number) => {
    restoreTargetRef.current = null;
    scrollToPage(page);
  }, [scrollToPage]);

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
        doc.getPage(i).then((page) => {
          const typedPage = page as { getTextContent: () => Promise<{ items: { str: string }[] }> };
          return typedPage.getTextContent();
        }).then((content) => {
          const typedContent = content as { items: { str: string }[] };
          return typedContent.items.map((item) => item.str);
        })
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
      let idx = lowerFull.indexOf(lowerQuery, pos);
      while (idx !== -1) {
        matches.push({ page: pageIdx + 1, start: idx, end: idx + lowerQuery.length });
        pos = idx + 1;
        idx = lowerFull.indexOf(lowerQuery, pos);
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
      restoreTargetRef.current = null;
      scrollToPage(match.page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchIndex, globalMatches]);

  // Highlight map for each page
  const highlightMapsByPage = useMemo(() => {
    if (!allPagesText || globalMatches.length === 0) {
      return new Map<number, Map<number, Array<[number, number, boolean]>>>();
    }
    const activeIdx = currentMatchIndex % globalMatches.length;
    const pageBoundaries = new Map<number, number[]>();
    const mapByPage = new Map<number, Map<number, Array<[number, number, boolean]>>>();

    const getBoundaries = (pageNumber: number, pageItems: string[]) => {
      const cached = pageBoundaries.get(pageNumber);
      if (cached) return cached;
      const boundaries = [0];
      pageItems.forEach((str) => boundaries.push(boundaries[boundaries.length - 1] + str.length));
      pageBoundaries.set(pageNumber, boundaries);
      return boundaries;
    };

    globalMatches.forEach((match, globalIdx) => {
      const pageItems = allPagesText[match.page - 1];
      if (!pageItems) return;
      const boundaries = getBoundaries(match.page, pageItems);
      const pageMap = mapByPage.get(match.page) ?? new Map<number, Array<[number, number, boolean]>>();
      if (!mapByPage.has(match.page)) mapByPage.set(match.page, pageMap);
      const isActive = globalIdx === activeIdx;
      for (let i = 0; i < pageItems.length; i++) {
        const itemStart = boundaries[i];
        const itemEnd = boundaries[i + 1];
        if (match.end <= itemStart) break;
        if (match.start >= itemEnd) continue;
        const localStart = Math.max(0, match.start - itemStart);
        const localEnd = Math.min(pageItems[i].length, match.end - itemStart);
        if (!pageMap.has(i)) pageMap.set(i, []);
        pageMap.get(i)!.push([localStart, localEnd, isActive]);
      }
    });

    return mapByPage;
  }, [allPagesText, globalMatches, currentMatchIndex]);

  // Custom text renderer — returns HTML string; matched regions wrapped in <mark>
  const customTextRenderer = useCallback(({ str, itemIndex, pageNumber }: { str: string; itemIndex: number; pageNumber: number }) => {
    const pageMap = highlightMapsByPage.get(pageNumber);
    const ranges = pageMap?.get(itemIndex);
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
  }, [highlightMapsByPage]);

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
  }, [currentPage, numPages, zoomPercent, goTo]);

  // --- Render ---
  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Toolbar */}
      <PdfToolbar
        title={title}
        backUrl={backUrl}
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

      {/* Search panel */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-muted border-b border-border">
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
            className="flex-1 bg-background text-foreground rounded px-2 py-1 text-sm placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-sm whitespace-nowrap select-none">
            {matchCount > 0 ? `${(currentMatchIndex % matchCount) + 1} of ${matchCount}` : "No matches"}
          </span>
          <button
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount)}
            aria-label="Previous match"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setCurrentMatchIndex((prev) => (prev + 1) % matchCount)}
            aria-label="Next match"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <button
            className="text-muted-foreground hover:text-foreground"
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
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4 bg-muted/30"
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-destructive gap-3">
            <p className="text-sm">{error}</p>
            <button
              className="text-sm px-3 py-1 rounded bg-muted text-foreground hover:bg-accent"
              onClick={() => {
                setError(null);
                setRetryToken((prev) => prev + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
            key={retryToken}
            file={fileUrl ?? `/api/books/${bookId}/file`}
            onLoadSuccess={(doc) => {
              setNumPages(doc.numPages);
              setCurrentPage((prev) => Math.min(prev, doc.numPages));
              docProxyRef.current = doc;
              setDocReady((n) => n + 1);
              initialScrollDone.current = false;
              pageContainerRefs.current = [];
              visibleRatiosRef.current.clear();
              restoreTargetRef.current = Math.min(initialPage, doc.numPages);
              doc.getPage(Math.min(initialPage, doc.numPages)).then((page) => {
                const typedPage = page as { getViewport: (opts: { scale: number }) => { width: number; height: number } };
                const vp = typedPage.getViewport({ scale: 1 });
                setPageAspectRatio(vp.height / vp.width);
              });
            }}
            onLoadError={(err) => {
              const message = String((err as Error | undefined)?.message ?? "");
              if (message.includes("404") || message.includes("410")) {
                setError("This shared link is no longer available.");
              } else {
                setError("Failed to load book. Please try again.");
              }
            }}
            loading={<Spinner />}
          >
            {numPages && fitReady && (
              <div className="flex w-full flex-col items-center gap-4">
                {Array.from({ length: numPages }, (_, index) => {
                  const pageNumber = index + 1;
                  const placeholderHeight = pageAspectRatio && effectiveWidth
                    ? Math.round(effectiveWidth * pageAspectRatio)
                    : undefined;
                  return (
                    <div
                      key={`page_${pageNumber}`}
                      ref={setPageRef(index)}
                      data-page-number={pageNumber}
                      className="w-full flex justify-center"
                      style={placeholderHeight ? { minHeight: `${placeholderHeight}px` } : undefined}
                    >
                      <Page
                        pageNumber={pageNumber}
                        width={effectiveWidth}
                        loading={<Spinner />}
                        onError={() => setError("Failed to load book. Please try again.")}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        customTextRenderer={customTextRenderer as (props: { str: string; itemIndex: number; pageNumber: number }) => string}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Document>
        )}
      </div>

    </div>
  );
}
