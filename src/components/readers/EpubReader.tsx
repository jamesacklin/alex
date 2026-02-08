"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Menu,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";

type TocItem = { label: string; href: string };
type FontSize = "small" | "medium" | "large" | "xl";

interface EpubReaderProps {
  bookId: string;
  title: string;
  initialLocation?: string;
  fileUrl?: string;
  backUrl?: string;
  onLocationChange: (epubLocation: string, percentComplete: number) => void;
}

export function EpubReader({
  bookId,
  title,
  initialLocation,
  fileUrl,
  backUrl,
  onLocationChange,
}: EpubReaderProps) {
  const [location, setLocation] = useState<string | number>(
    initialLocation ?? 0,
  );
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [renditionReady, setRenditionReady] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Fetch epub as ArrayBuffer
  useEffect(() => {
    const url = fileUrl ?? `/api/books/${bookId}/book.epub`;
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          const error = new Error(`HTTP_${res.status}`);
          (error as Error & { status?: number }).status = res.status;
          throw error;
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        setEpubData(buffer);
      })
      .catch((err) => {
        const status = (err as Error & { status?: number }).status;
        if (status === 404 || status === 410) {
          setError("This shared link is no longer available.");
        } else {
          setError("Failed to load book. Please try again.");
        }
        setLoading(false);
      });
  }, [bookId, fileUrl, reloadToken]);

  // Load settings from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("epub-reader-settings");
    if (saved) {
      try {
        const { fontSize: savedFontSize } = JSON.parse(saved);
        if (savedFontSize) setFontSize(savedFontSize);
      } catch (err) {
        console.error("Failed to load reader settings:", err);
      }
    }
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("epub-reader-settings", JSON.stringify({ fontSize }));
  }, [fontSize]);

  // Apply settings to rendition whenever they change
  useEffect(() => {
    if (!renditionRef.current || !renditionReady) return;

    const fontSizeMap = {
      small: "18px",
      medium: "24px",
      large: "32px",
      xl: "40px",
    };

    renditionRef.current.themes.font("Times New Roman");
    renditionRef.current.themes.fontSize(fontSizeMap[fontSize]);
  }, [fontSize, renditionReady]);

  const handleLocationChanged = useCallback(
    (epubcfi: string) => {
      setLocation(epubcfi);
      setLoading(false);

      if (!renditionRef.current) return;

      const book = renditionRef.current.book;

      // Track current chapter for TOC highlighting
      const currentLocation = renditionRef.current.currentLocation() as { start?: { href?: string } } | null;
      if (currentLocation?.start?.href) {
        setCurrentHref(currentLocation.start.href);
      }

      // Only save progress if locations are ready and CFI is valid
      if (
        book.locations.length() > 0 &&
        typeof epubcfi === "string" &&
        epubcfi.startsWith("epubcfi(")
      ) {
        try {
          const percent = book.locations.percentageFromCfi(epubcfi) * 100;
          onLocationChange(epubcfi, percent);
        } catch (err) {
          console.error(
            "Failed to calculate percentage from CFI:",
            epubcfi,
            err,
          );
        }
      }
    },
    [onLocationChange],
  );

  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Set font to Times New Roman
    rendition.themes.font("Times New Roman");

    // Hook error listener for book load failures
    rendition.book.on("openFailed", (err: unknown) => {
      console.error("ePub load error:", err);
      setError("Failed to load book. Please try again.");
      setLoading(false);
    });

    // Hide loading spinner once book is ready
    rendition.book.ready
      .then(() => {
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error("Failed to load book:", err);
      });

    // Extract table of contents
    rendition.book.loaded.navigation.then((nav: { toc?: TocItem[] }) => {
      setToc(nav.toc || []);
    });

    // Generate location spine for percentage tracking
    rendition.book.ready
      .then(() => {
        rendition.book.locations.generate(1024);
        // Signal that rendition is ready for theme application
        setRenditionReady(true);
      })
      .catch((err: unknown) => {
        console.error("Failed to generate locations:", err);
        // Don't block the reader — percentage tracking just won't work
      });
  }, []);

  // Chapter navigation
  const handleChapterClick = (href: string) => {
    if (!renditionRef.current) return;

    const book = renditionRef.current.book;
    const section = book.spine.get(href);

    if (section) {
      // Display by section index to avoid href resolution issues
      renditionRef.current.display(section.index);
    } else {
      // Fallback: try displaying the href directly
      console.warn("Section not found for href:", href);
      renditionRef.current.display(href);
    }

    setTocOpen(false);
  };

  const currentChapterIndex = toc.findIndex((item) =>
    currentHref?.startsWith(item.href.split("#")[0]),
  );

  const handlePrevChapter = () => {
    if (currentChapterIndex > 0) {
      handleChapterClick(toc[currentChapterIndex - 1].href);
    }
  };

  const handleNextChapter = () => {
    if (currentChapterIndex < toc.length - 1) {
      handleChapterClick(toc[currentChapterIndex + 1].href);
    }
  };

  // Error state
  if (error) {
    return (
      <div className="flex flex-col h-full bg-background">
        <header className="flex items-center gap-3 px-4 h-12 bg-gray-900 text-white shrink-0">
          <Link
            href={backUrl ?? "/library"}
            className="p-1 rounded hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-sm font-medium truncate">{title}</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              setEpubData(null);
              setRenditionReady(false);
              setReloadToken((prev) => prev + 1);
            }}
            className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
          <Link
            href={backUrl ?? "/library"}
            className="text-sm text-primary hover:underline"
          >
            Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 h-12 bg-gray-900 text-white shrink-0">
        <Link
          href={backUrl ?? "/library"}
          className="p-1 rounded hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-sm font-medium truncate flex-1">{title}</h1>

        {/* Chapter navigation */}
        <button
          onClick={handlePrevChapter}
          disabled={currentChapterIndex <= 0}
          className="p-1 rounded hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous chapter"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={handleNextChapter}
          disabled={currentChapterIndex >= toc.length - 1 || toc.length === 0}
          className="p-1 rounded hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next chapter"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* TOC toggle */}
        <button
          onClick={() => setTocOpen(!tocOpen)}
          className="p-1 rounded hover:bg-gray-800 transition-colors"
          aria-label="Table of contents"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Reading settings */}
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="p-1 rounded hover:bg-gray-800 transition-colors"
          aria-label="Reading settings"
        >
          <Settings className="h-5 w-5" />
        </button>
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

        {/* Table of Contents */}
        {tocOpen && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 z-20"
              onClick={() => setTocOpen(false)}
            />
            {/* TOC Sidebar */}
            <div className="absolute inset-y-0 left-0 w-80 bg-background border-r shadow-lg z-30 overflow-y-auto">
              <div className="p-4 border-b bg-muted/50">
                <h2 className="font-semibold">Table of Contents</h2>
              </div>
              <nav className="p-2">
                {toc.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">
                    Loading chapters…
                  </p>
                ) : (
                  toc.map((item, index) => (
                    <button
                      key={index}
                      onClick={() => handleChapterClick(item.href)}
                      className={`block w-full text-left px-3 py-2 rounded text-sm hover:bg-accent transition-colors ${
                        currentHref?.startsWith(item.href.split("#")[0])
                          ? "bg-accent font-medium"
                          : ""
                      }`}
                    >
                      {item.label}
                    </button>
                  ))
                )}
              </nav>
            </div>
          </>
        )}

        {/* Reading Settings */}
        {settingsOpen && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 z-20"
              onClick={() => setSettingsOpen(false)}
            />
            {/* Settings Panel */}
            <div className="absolute top-4 right-4 w-72 bg-background border rounded-lg shadow-xl z-30 p-4">
              <h3 className="font-semibold mb-4">Reading Settings</h3>

              {/* Font Size */}
              <div className="mb-4">
                <label className="text-sm font-medium mb-2 block">
                  Font Size
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["small", "medium", "large", "xl"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => setFontSize(size)}
                      className={`px-3 py-2 rounded text-sm border transition-colors ${
                        fontSize === size
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {size === "small"
                        ? "S"
                        : size === "medium"
                          ? "M"
                          : size === "large"
                            ? "L"
                            : "XL"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {epubData && (
          <ReactReader
            url={epubData}
            location={location}
            locationChanged={handleLocationChanged}
            getRendition={handleGetRendition}
            showToc={false}
          />
        )}
      </div>
    </div>
  );
}
