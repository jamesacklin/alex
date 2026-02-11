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
import {
  ReactReader,
  ReactReaderStyle,
  EpubViewStyle,
  type IReactReaderStyle,
  type IEpubViewStyle,
} from "react-reader";
import type { Rendition } from "epubjs";

type TocItem = { label: string; href: string };
type FontSize = "small" | "medium" | "large" | "xl";
type EpubContent = { document?: Document };

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
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renditionReady, setRenditionReady] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const progressKey = `epub-progress:${bookId}`;
  const autoAdvanceLocks = useRef(new WeakMap<object, number>());
  const autoAdvanceAttached = useRef(new WeakSet<Document>());
  const autoAdvanceTargets = useRef(new WeakSet<EventTarget>());
  const autoAdvanceContainers = useRef(new WeakSet<HTMLElement>());

  const fontSizeMap: Record<FontSize, string> = {
    small: "18px",
    medium: "24px",
    large: "32px",
    xl: "40px",
  };

  const getInitialFontSize = useCallback((): FontSize => {
    if (typeof window === "undefined") return "medium";
    try {
      const saved = localStorage.getItem("epub-reader-settings");
      if (saved) {
        const { fontSize: savedFontSize } = JSON.parse(saved);
        if (
          savedFontSize === "small" ||
          savedFontSize === "medium" ||
          savedFontSize === "large" ||
          savedFontSize === "xl"
        ) {
          return savedFontSize;
        }
      }
    } catch (err) {
      console.error("Failed to load reader settings:", err);
    }
    return "medium";
  }, []);

  const getInitialLocation = useCallback((): string | number => {
    if (initialLocation) return initialLocation;
    if (typeof window === "undefined") return 0;
    try {
      const saved = localStorage.getItem(progressKey);
      if (saved) {
        const { epubLocation } = JSON.parse(saved) as {
          epubLocation?: string;
        };
        if (epubLocation) return epubLocation;
      }
    } catch (err) {
      console.error("Failed to load epub progress:", err);
    }
    return 0;
  }, [initialLocation, progressKey]);

  const [location, setLocation] = useState<string | number>(() =>
    getInitialLocation(),
  );
  const [fontSize, setFontSize] = useState<FontSize>(() =>
    getInitialFontSize(),
  );

  const getThemeVars = useCallback(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const background = read("--background", "#ffffff");
    const text = read("--primary", read("--foreground", "#000000"));
    const primary = read("--primary", text);
    const primaryForeground = read("--primary-foreground", background);
    return { background, text, primary, primaryForeground };
  }, []);

  const applyThemeToDocument = useCallback(
    (doc: Document) => {
      const { background, text, primary, primaryForeground } =
        getThemeVars();
      doc.documentElement.style.setProperty(
        "background",
        background,
        "important",
      );
      doc.documentElement.style.setProperty(
        "color",
        text,
        "important",
      );
      if (doc.body) {
        doc.body.style.setProperty("background", background, "important");
        doc.body.style.setProperty("color", text, "important");
      }

      const existing = doc.getElementById("alex-epub-theme");
      if (existing) {
        existing.remove();
      }
      const style = doc.createElement("style");
      style.id = "alex-epub-theme";
      style.textContent = `
        html, body { background: ${background} !important; color: ${text} !important; }
        body, body * { color: ${text} !important; }
        a { color: ${primary} !important; }
        ::selection { background: ${primary} !important; color: ${primaryForeground} !important; }
      `;
      doc.head.appendChild(style);
    },
    [getThemeVars],
  );

  const applyThemeToRendition = useCallback(
    (rendition: Rendition) => {
      const { background, text, primary, primaryForeground } =
        getThemeVars();
      rendition.themes.default({
        html: {
          background: `${background} !important`,
          color: `${text} !important`,
        },
        body: {
          background: `${background} !important`,
          color: `${text} !important`,
        },
        "body *": { color: `${text} !important` },
        a: { color: `${primary} !important` },
        "::selection": {
          background: `${primary} !important`,
          color: `${primaryForeground} !important`,
        },
      });

      const rawContents = rendition.getContents?.() as unknown;
      const contents = (Array.isArray(rawContents)
        ? rawContents
        : rawContents
          ? [rawContents]
          : []) as EpubContent[];
      contents.forEach((content) => {
        if (content?.document) {
          applyThemeToDocument(content.document);
        }
      });
    },
    [applyThemeToDocument, getThemeVars],
  );

  const attachAutoAdvance = useCallback((doc: Document) => {
    if (autoAdvanceAttached.current.has(doc)) return;
    autoAdvanceAttached.current.add(doc);

    const handler = (event?: Event) => {
      const eventTarget =
        event?.target && event.target instanceof Element
          ? event.target
          : null;
      const scrollingElement =
        eventTarget ||
        doc.scrollingElement ||
        doc.documentElement ||
        doc.body;
      if (!scrollingElement) return;
      const { scrollTop, clientHeight, scrollHeight } = scrollingElement;

      if (scrollHeight <= clientHeight + 8) return;

      if (scrollTop + clientHeight >= scrollHeight - 24) {
        const now = Date.now();
        const last = autoAdvanceLocks.current.get(doc) ?? 0;
        if (now - last < 750) return;
        autoAdvanceLocks.current.set(doc, now);
        renditionRef.current?.next();
      }
    };

    const targets: Array<EventTarget | null | undefined> = [
      doc.defaultView,
      doc.scrollingElement,
      doc.documentElement,
      doc.body,
    ];

    targets.forEach((target) => {
      if (!target || autoAdvanceTargets.current.has(target)) return;
      autoAdvanceTargets.current.add(target);
      target.addEventListener("scroll", handler as EventListener, {
        passive: true,
      });
    });
  }, []);

  const attachAutoAdvanceContainer = useCallback((container?: HTMLElement | null) => {
    if (!container || autoAdvanceContainers.current.has(container)) return;
    autoAdvanceContainers.current.add(container);

    const handler = () => {
      const { scrollTop, clientHeight, scrollHeight } = container;
      if (scrollHeight <= clientHeight + 8) return;
      if (scrollTop + clientHeight >= scrollHeight - 24) {
        const now = Date.now();
        const last = autoAdvanceLocks.current.get(container) ?? 0;
        if (now - last < 750) return;
        autoAdvanceLocks.current.set(container, now);
        renditionRef.current?.next();
      }
    };

    container.addEventListener("scroll", handler, { passive: true });
  }, []);

  const epubUrl = fileUrl ?? `/api/books/${bookId}/book.epub`;
  const readerStyles: IReactReaderStyle = {
    ...ReactReaderStyle,
    container: {
      ...ReactReaderStyle.container,
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
    },
    readerArea: {
      ...ReactReaderStyle.readerArea,
      backgroundColor: "var(--background)",
    },
    reader: {
      ...ReactReaderStyle.reader,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    titleArea: {
      ...ReactReaderStyle.titleArea,
      color: "var(--muted-foreground)",
    },
    arrow: {
      ...ReactReaderStyle.arrow,
      color: "var(--muted-foreground)",
      display: "none",
      pointerEvents: "none",
    },
    prev: {
      ...ReactReaderStyle.prev,
      display: "none",
      pointerEvents: "none",
    },
    next: {
      ...ReactReaderStyle.next,
      display: "none",
      pointerEvents: "none",
    },
    arrowHover: {
      ...ReactReaderStyle.arrowHover,
      color: "var(--foreground)",
    },
    tocArea: {
      ...ReactReaderStyle.tocArea,
      background: "var(--background)",
      borderRight: "1px solid var(--border)",
    },
    tocAreaButton: {
      ...ReactReaderStyle.tocAreaButton,
      color: "var(--muted-foreground)",
      borderBottom: "1px solid var(--border)",
    },
    tocButtonExpanded: {
      ...ReactReaderStyle.tocButtonExpanded,
      background: "var(--muted)",
    },
    tocButtonBar: {
      ...ReactReaderStyle.tocButtonBar,
      background: "var(--border)",
    },
    loadingView: {
      ...ReactReaderStyle.loadingView,
      color: "var(--muted-foreground)",
    },
    errorView: {
      ...ReactReaderStyle.errorView,
      color: "var(--destructive)",
    },
  };
  const epubViewStyles: IEpubViewStyle = {
    ...EpubViewStyle,
    viewHolder: {
      ...EpubViewStyle.viewHolder,
      backgroundColor: "var(--background)",
    },
    view: {
      ...EpubViewStyle.view,
      width: "100%",
      height: "100%",
    },
  };

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("epub-reader-settings", JSON.stringify({ fontSize }));
  }, [fontSize]);

  // Apply settings to rendition whenever they change
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.font("Times New Roman");
    renditionRef.current.themes.fontSize(fontSizeMap[fontSize]);
  }, [fontSize]);

  useEffect(() => {
    if (!renditionRef.current || !renditionReady) return;
    const apply = () => applyThemeToRendition(renditionRef.current!);
    apply();

    const observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => observer.disconnect();
  }, [applyThemeToRendition, renditionReady]);

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
          localStorage.setItem(
            progressKey,
            JSON.stringify({ epubLocation: epubcfi, percentComplete: percent }),
          );
        } catch (err) {
          console.error(
            "Failed to calculate percentage from CFI:",
            epubcfi,
            err,
          );
        }
      }
    },
    [onLocationChange, progressKey],
  );

  const handleGetRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Set font to Times New Roman
    rendition.themes.font("Times New Roman");
    rendition.themes.fontSize(fontSizeMap[fontSize]);
    applyThemeToRendition(rendition);

    // Single-column, continuous vertical scroll
    rendition.flow("scrolled-continuous");
    rendition.spread("none");

    rendition.hooks.content.register((contents: EpubContent) => {
      if (contents?.document) {
        applyThemeToDocument(contents.document);
        attachAutoAdvance(contents.document);
        const frame = contents.document.defaultView?.frameElement as
          | HTMLElement
          | null
          | undefined;
        const container = frame?.closest(".epub-container") as
          | HTMLElement
          | null
          | undefined;
        attachAutoAdvanceContainer(container);
      }
    });

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
        setError("Failed to load book. Please try again.");
        setLoading(false);
      });

    // Extract table of contents
    rendition.book.loaded.navigation
      .then((nav: { toc?: TocItem[] }) => {
        setToc(nav.toc || []);
      })
      .catch((err: unknown) => {
        console.error("Failed to load table of contents:", err);
      });

    // Generate location spine for percentage tracking
    rendition.book.ready
      .then(() => {
        return rendition.book.locations.generate(1024);
      })
      .then(() => {
        // Signal that rendition is ready for theme application
        setRenditionReady(true);
      })
      .catch((err: unknown) => {
        console.error("Failed to generate locations:", err);
        // Don't block the reader — percentage tracking just won't work
      });
  }, [applyThemeToDocument, applyThemeToRendition]);

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
        <header className="flex items-center gap-3 px-4 h-12 bg-sidebar text-sidebar-foreground border-b border-border shrink-0">
          <Link
            href={backUrl ?? "/library"}
            className="p-1 rounded hover:bg-muted transition-colors"
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
              setRenditionReady(false);
              setReloadToken((prev) => prev + 1);
            }}
            className="text-sm px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
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
      <header className="flex items-center gap-3 px-4 h-12 bg-sidebar text-sidebar-foreground border-b border-border shrink-0">
        <Link
          href={backUrl ?? "/library"}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-sm font-medium truncate flex-1">{title}</h1>

        {/* Chapter navigation */}
        <button
          onClick={handlePrevChapter}
          disabled={currentChapterIndex <= 0}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous chapter"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={handleNextChapter}
          disabled={currentChapterIndex >= toc.length - 1 || toc.length === 0}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next chapter"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* TOC toggle */}
        <button
          onClick={() => setTocOpen(!tocOpen)}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label="Table of contents"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Reading settings */}
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="p-1 rounded hover:bg-muted transition-colors"
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

        <ReactReader
          key={reloadToken}
          url={epubUrl}
          location={location}
          locationChanged={handleLocationChanged}
          getRendition={handleGetRendition}
          showToc={false}
          readerStyles={readerStyles}
          epubViewStyles={epubViewStyles}
          epubOptions={{
            allowScriptedContent: true,
            flow: "scrolled-continuous",
            manager: "continuous",
            spread: "none",
          }}
        />
      </div>
    </div>
  );
}
