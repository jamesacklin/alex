"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
type RenditionLocation = { start?: { cfi?: string; href?: string } };
type RenditionSection = { index?: number };
type RenderedSectionIdentity = { index: number; href?: string };

function getLocationStart(
  location: RenditionLocation | RenditionLocation[] | null | undefined,
) {
  if (!location) return null;
  return Array.isArray(location)
    ? (location[0]?.start ?? null)
    : (location.start ?? null);
}

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
  const autoAdvanceLocks = useRef<{ next: number; prev: number }>({
    next: 0,
    prev: 0,
  });
  const autoAdvanceAttached = useRef(new WeakSet<Document>());
  const autoAdvanceTargets = useRef(new WeakSet<EventTarget>());
  const autoAdvanceContainers = useRef(new WeakSet<HTMLElement>());
  const autoAdvanceWheelTargets = useRef(new WeakSet<EventTarget>());
  const lastScrollPositions = useRef(new WeakMap<object, number>());
  const renderedSectionByDoc = useRef(
    new WeakMap<Document, RenderedSectionIdentity>(),
  );
  const renderedSectionByFrame = useRef(
    new WeakMap<HTMLElement, RenderedSectionIdentity>(),
  );
  const pendingSectionTransition = useRef<{
    direction: "prev";
    targetIndex: number;
    requestedAt: number;
  } | null>(null);
  const lastWheelIntent = useRef<{
    direction: "up" | "down";
    at: number;
  } | null>(null);
  const lastLocalPersistAt = useRef(0);
  const lastLocalPersistedCfi = useRef<string | null>(null);

  const fontSizeMap = useMemo<Record<FontSize, string>>(
    () => ({
      small: "18px",
      medium: "24px",
      large: "32px",
      xl: "40px",
    }),
    [],
  );

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
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(progressKey);
        if (saved) {
          const { epubLocation } = JSON.parse(saved) as {
            epubLocation?: string;
          };
          if (
            typeof epubLocation === "string" &&
            epubLocation.startsWith("epubcfi(")
          ) {
            return epubLocation;
          }
        }
      } catch (err) {
        console.error("Failed to load epub progress:", err);
      }
    }
    if (initialLocation) return initialLocation;
    return 0;
  }, [initialLocation, progressKey]);

  const [location, setLocation] = useState<string | number>(() =>
    getInitialLocation(),
  );
  const [fontSize, setFontSize] = useState<FontSize>(() =>
    getInitialFontSize(),
  );
  const epubFontFamily = "\"IBM Plex Serif\", serif";
  const epubFontWeight = 300;
  const epubLineHeight = 1.6;
  const epubColumnWidth = "80ch";

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
      const { background, text, primary, primaryForeground } = getThemeVars();
      doc.documentElement.style.setProperty(
        "background",
        background,
        "important",
      );
      doc.documentElement.style.setProperty("color", text, "important");
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
        @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@300;400;700&display=swap");
        html, body {
          background: ${background} !important;
          color: ${text} !important;
          font-family: ${epubFontFamily} !important;
          font-weight: ${epubFontWeight} !important;
          line-height: ${epubLineHeight} !important;
          font-size: ${fontSizeMap[fontSize]} !important;
        }
        html { margin: 0 !important; padding: 0 !important; }
        body {
          margin: 0 !important;
          padding: 1.25rem 1rem 2rem !important;
          box-sizing: border-box !important;
        }
        body > *,
        body :where(div, section, article, main, p, li, ul, ol, blockquote, pre, table, figure, h1, h2, h3, h4, h5, h6) {
          width: 100% !important;
          max-width: ${epubColumnWidth} !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }
        body * {
          color: ${text} !important;
          font-family: inherit !important;
          font-size: inherit !important;
          line-height: inherit !important;
        }
        img, svg, video, canvas, table, pre {
          max-width: 100% !important;
          height: auto !important;
        }
        a { color: ${primary} !important; }
        ::selection { background: ${primary} !important; color: ${primaryForeground} !important; }
      `;
      doc.head.appendChild(style);
    },
    [
      epubFontFamily,
      epubFontWeight,
      epubLineHeight,
      epubColumnWidth,
      fontSize,
      fontSizeMap,
      getThemeVars,
    ],
  );

  const applyThemeToRendition = useCallback(
    (rendition: Rendition) => {
      const { background, text, primary, primaryForeground } = getThemeVars();
      rendition.themes.default({
        html: {
          background: `${background} !important`,
          color: `${text} !important`,
          fontSize: `${fontSizeMap[fontSize]} !important`,
        },
        body: {
          background: `${background} !important`,
          color: `${text} !important`,
          fontFamily: `${epubFontFamily} !important`,
          fontWeight: `${epubFontWeight} !important`,
          lineHeight: `${epubLineHeight} !important`,
          fontSize: `${fontSizeMap[fontSize]} !important`,
          margin: "0 !important",
          padding: "1.25rem 1rem 2rem !important",
          boxSizing: "border-box !important",
        },
        "body > *, body :where(div, section, article, main, p, li, ul, ol, blockquote, pre, table, figure, h1, h2, h3, h4, h5, h6)": {
          width: "100% !important",
          maxWidth: `${epubColumnWidth} !important`,
          marginLeft: "auto !important",
          marginRight: "auto !important",
          boxSizing: "border-box !important",
        },
        "body *": {
          color: `${text} !important`,
          fontFamily: "inherit !important",
          fontSize: "inherit !important",
          lineHeight: "inherit !important",
        },
        "img, svg, video, canvas, table, pre": {
          maxWidth: "100% !important",
          height: "auto !important",
        },
        a: { color: `${primary} !important` },
        "::selection": {
          background: `${primary} !important`,
          color: `${primaryForeground} !important`,
        },
      });

      const rawContents = rendition.getContents?.() as unknown;
      const contents = (
        Array.isArray(rawContents)
          ? rawContents
          : rawContents
            ? [rawContents]
            : []
      ) as EpubContent[];
      contents.forEach((content) => {
        if (content?.document) {
          applyThemeToDocument(content.document);
        }
      });
    },
    [
      applyThemeToDocument,
      epubFontFamily,
      epubFontWeight,
      epubLineHeight,
      epubColumnWidth,
      fontSize,
      fontSizeMap,
      getThemeVars,
    ],
  );


  const applyFontSettingsToRendition = useCallback(
    (rendition: Rendition) => {
      rendition.themes.font(epubFontFamily);
      rendition.themes.fontSize(fontSizeMap[fontSize]);
    },
    [epubFontFamily, fontSize, fontSizeMap],
  );


  const persistLocalProgress = useCallback(
    (epubLocation: string, percentComplete: number) => {
      localStorage.setItem(
        progressKey,
        JSON.stringify({
          epubLocation,
          percentComplete,
          updatedAt: Date.now(),
        }),
      );
    },
    [progressKey],
  );

  const persistCurrentLocationToLocal = useCallback(
    (force = false) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const book = rendition.book;
      if (!book?.locations || book.locations.length() === 0) return;

      const now = Date.now();
      if (!force && now - lastLocalPersistAt.current < 350) return;

      const currentLocation = rendition.currentLocation() as
        | RenditionLocation
        | RenditionLocation[]
        | null;
      const start = getLocationStart(currentLocation);
      const epubcfi = start?.cfi;
      if (!epubcfi || !epubcfi.startsWith("epubcfi(")) return;
      if (!force && epubcfi === lastLocalPersistedCfi.current) return;

      try {
        const percent = book.locations.percentageFromCfi(epubcfi) * 100;
        persistLocalProgress(epubcfi, percent);
        lastLocalPersistAt.current = now;
        lastLocalPersistedCfi.current = epubcfi;
      } catch (err) {
        console.error("Failed to persist current location:", err);
      }
    },
    [persistLocalProgress],
  );

  const shouldTriggerEdgeAction = useCallback((direction: "next" | "prev") => {
    const now = Date.now();
    if (now - autoAdvanceLocks.current[direction] < 750) return false;
    autoAdvanceLocks.current[direction] = now;
    return true;
  }, []);

  const resolveCurrentSectionIndex = useCallback((rendition: Rendition) => {
    const currentLocation = rendition.currentLocation() as
      | RenditionLocation
      | RenditionLocation[]
      | null;
    const start = getLocationStart(currentLocation);
    const href = start?.href;
    if (!href) return null;

    const normalizeHref = (value: string) =>
      decodeURIComponent(value)
        .split("#")[0]
        .split("?")[0]
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^file:\/\//i, "")
        .replace(/^\/+/, "")
        .replace(/^\.\//, "");

    const normalizedHref = normalizeHref(href);
    const section =
      rendition.book.spine.get(href) ||
      rendition.book.spine.get(normalizedHref) ||
      rendition.book.spine.get(`/${normalizedHref}`);

    if (section && typeof section.index === "number") {
      return section.index;
    }

    const spineItems = (
      rendition.book.spine as unknown as {
        spineItems?: Array<{ href?: string; url?: string; index?: number }>;
      }
    ).spineItems;
    if (!Array.isArray(spineItems)) return null;

    const matched = spineItems.find((item) => {
      if (typeof item.index !== "number") return false;
      const candidates = [item.href, item.url].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      return candidates.some((candidate) => {
        const normalizedCandidate = normalizeHref(candidate);
        return (
          normalizedCandidate === normalizedHref ||
          normalizedCandidate.endsWith(normalizedHref) ||
          normalizedHref.endsWith(normalizedCandidate)
        );
      });
    });

    return matched && typeof matched.index === "number" ? matched.index : null;
  }, []);

  const recordWheelIntent = useCallback((deltaY: number) => {
    if (deltaY === 0) return;
    lastWheelIntent.current = {
      direction: deltaY < 0 ? "up" : "down",
      at: Date.now(),
    };
  }, []);

  const getWheelDeltaY = useCallback((event: Event) => {
    const delta = (event as { deltaY?: unknown }).deltaY;
    return typeof delta === "number" && Number.isFinite(delta) ? delta : null;
  }, []);

  const resolveRenderedSectionIndex = useCallback(
    (sourceContext?: EventTarget | null) => {
      if (!sourceContext) return null;

      if (
        sourceContext instanceof HTMLElement &&
        renderedSectionByFrame.current.has(sourceContext)
      ) {
        return renderedSectionByFrame.current.get(sourceContext)!.index;
      }

      const doc =
        sourceContext instanceof Document
          ? sourceContext
          : sourceContext instanceof Element
            ? sourceContext.ownerDocument
            : sourceContext instanceof Window
              ? sourceContext.document
              : null;

      if (!doc) return null;
      const section = renderedSectionByDoc.current.get(doc);
      return section?.index ?? null;
    },
    [],
  );

  const triggerPrevBoundaryTransition = useCallback((sourceContext?: EventTarget | null) => {
    const pending = pendingSectionTransition.current;
    if (pending && Date.now() - pending.requestedAt <= 2000) return;
    if (pending && Date.now() - pending.requestedAt > 2000) {
      pendingSectionTransition.current = null;
    }
    if (!shouldTriggerEdgeAction("prev")) return;

    const rendition = renditionRef.current;
    if (!rendition) return;

    const renderedIndex = resolveRenderedSectionIndex(sourceContext);
    const currentIndex =
      renderedIndex ?? resolveCurrentSectionIndex(rendition);

    if (currentIndex !== null && currentIndex > 0) {
      pendingSectionTransition.current = {
        direction: "prev",
        targetIndex: currentIndex - 1,
        requestedAt: Date.now(),
      };
      rendition.display(currentIndex - 1);
      return;
    }

    rendition.prev();
  }, [resolveCurrentSectionIndex, resolveRenderedSectionIndex, shouldTriggerEdgeAction]);

  const handleBoundaryScroll = useCallback(
    (
      scrollingElement: Element,
      lockKey: object,
    ) => {
      const target = scrollingElement as HTMLElement;
      const { scrollTop, clientHeight, scrollHeight } = target;
      const previousTop = lastScrollPositions.current.get(lockKey);
      lastScrollPositions.current.set(lockKey, scrollTop);
      const wheelIntent = lastWheelIntent.current;
      const wheelIntentIsFresh =
        wheelIntent && Date.now() - wheelIntent.at <= 300;
      const intentUp = wheelIntentIsFresh && wheelIntent.direction === "up";
      const intentDown = wheelIntentIsFresh && wheelIntent.direction === "down";

      persistCurrentLocationToLocal();
      if (scrollHeight <= clientHeight + 8) return;
      if (!renditionReady) return;

      const delta =
        previousTop === undefined ? 0 : scrollTop - previousTop;
      const shouldTriggerNext =
        scrollTop + clientHeight >= scrollHeight - 24 &&
        (delta > 0 || (delta === 0 && !!intentDown));
      const shouldTriggerPrev =
        scrollTop <= 24 &&
        (delta < 0 || (delta === 0 && !!intentUp));

      if (shouldTriggerNext) {
        if (!shouldTriggerEdgeAction("next")) return;
        renditionRef.current?.next();
        return;
      }

      if (shouldTriggerPrev) {
        triggerPrevBoundaryTransition(scrollingElement);
      }
    },
    [
      persistCurrentLocationToLocal,
      renditionReady,
      triggerPrevBoundaryTransition,
      shouldTriggerEdgeAction,
    ],
  );

  const attachAutoAdvance = useCallback(
    (doc: Document) => {
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
        handleBoundaryScroll(scrollingElement, doc);
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
        if (!autoAdvanceWheelTargets.current.has(target)) {
          autoAdvanceWheelTargets.current.add(target);
          target.addEventListener(
            "wheel",
            ((event: Event) => {
              const deltaY = getWheelDeltaY(event);
              if (deltaY === null) return;

              recordWheelIntent(deltaY);
              const scrollingElement =
                doc.scrollingElement || doc.documentElement || doc.body;
              const currentTop =
                scrollingElement &&
                scrollingElement instanceof HTMLElement
                  ? scrollingElement.scrollTop
                  : 0;
              if (
                deltaY < 0 &&
                scrollingElement &&
                (currentTop <= 24 || currentTop + deltaY <= 24)
              ) {
                triggerPrevBoundaryTransition(scrollingElement);
              }
            }) as EventListener,
            { passive: true },
          );
        }
      });
    },
    [
      getWheelDeltaY,
      handleBoundaryScroll,
      recordWheelIntent,
      triggerPrevBoundaryTransition,
    ],
  );

  const attachAutoAdvanceContainer = useCallback(
    (container?: HTMLElement | null) => {
      if (!container || autoAdvanceContainers.current.has(container)) return;
      autoAdvanceContainers.current.add(container);

      const handler = () => {
        handleBoundaryScroll(container, container);
      };
      const wheelHandler = (event: WheelEvent) => {
        recordWheelIntent(event.deltaY);
        if (
          event.deltaY < 0 &&
          (container.scrollTop <= 24 || container.scrollTop + event.deltaY <= 24)
        ) {
          triggerPrevBoundaryTransition(container);
        }
      };

      container.addEventListener("scroll", handler, { passive: true });
      if (!autoAdvanceWheelTargets.current.has(container)) {
        autoAdvanceWheelTargets.current.add(container);
        container.addEventListener("wheel", wheelHandler, { passive: true });
      }
    },
    [handleBoundaryScroll, recordWheelIntent, triggerPrevBoundaryTransition],
  );

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
    applyFontSettingsToRendition(renditionRef.current);
  }, [applyFontSettingsToRendition]);

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

  useEffect(() => {
    return () => {
      pendingSectionTransition.current = null;
      persistCurrentLocationToLocal(true);
    };
  }, [persistCurrentLocationToLocal]);

  const handleLocationChanged = useCallback(
    (epubcfi: string) => {
      setLocation(epubcfi);
      setLoading(false);

      if (!renditionRef.current) return;

      const book = renditionRef.current.book;

      // Track current chapter for TOC highlighting
      const currentLocation = renditionRef.current.currentLocation() as
        | RenditionLocation
        | RenditionLocation[]
        | null;
      const start = getLocationStart(currentLocation);
      if (start?.href) {
        setCurrentHref(start.href);
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
          persistLocalProgress(epubcfi, percent);
          lastLocalPersistAt.current = Date.now();
          lastLocalPersistedCfi.current = epubcfi;
        } catch (err) {
          console.error(
            "Failed to calculate percentage from CFI:",
            epubcfi,
            err,
          );
        }
      }
    },
    [onLocationChange, persistLocalProgress],
  );

  const handleGetRendition = useCallback(
    (rendition: Rendition) => {
      renditionRef.current = rendition;

      // Set font family, size, and cross-book scaling behavior
      applyFontSettingsToRendition(rendition);
      applyThemeToRendition(rendition);

      // Single-column, continuous vertical scroll
      rendition.flow("scrolled-continuous");
      rendition.spread("none");

      const getDocumentFromContents = (
        contents: EpubContent | HTMLIFrameElement | unknown,
      ) => {
        return (
          (contents as EpubContent | null | undefined)?.document ||
          (contents &&
          typeof HTMLIFrameElement !== "undefined" &&
          contents instanceof HTMLIFrameElement
            ? contents.contentDocument
            : null)
        );
      };

      const handleRenderedContent = (
        contents: EpubContent | null | undefined,
      ) => {
        const doc = getDocumentFromContents(contents);
        if (!doc) return;
        applyThemeToDocument(doc);
        attachAutoAdvance(doc);
        const frame = doc.defaultView?.frameElement as
          | HTMLElement
          | null
          | undefined;
        const container = frame?.closest(".epub-container") as
          | HTMLElement
          | null
          | undefined;
        attachAutoAdvanceContainer(container);
      };

      if (rendition.hooks?.content?.register) {
        rendition.hooks.content.register((contents: EpubContent) => {
          handleRenderedContent(contents);
        });
      } else {
        rendition.on("rendered", (_section: unknown, contents: unknown) => {
          handleRenderedContent(contents as EpubContent);
        });
      }

      rendition.on(
        "rendered",
        (section: RenditionSection | undefined, contents: unknown) => {
          const doc = getDocumentFromContents(contents);
          const sectionIdentity =
            typeof section?.index === "number"
              ? ({
                  index: section.index,
                  href: (section as RenditionSection & { href?: string }).href,
                } satisfies RenderedSectionIdentity)
              : null;
          if (doc && sectionIdentity) {
            renderedSectionByDoc.current.set(doc, sectionIdentity);
            const frame = doc.defaultView?.frameElement as
              | HTMLElement
              | null
              | undefined;
            if (frame) {
              renderedSectionByFrame.current.set(frame, sectionIdentity);
            }
          }

          const pending = pendingSectionTransition.current;
          if (!pending) return;

          const age = Date.now() - pending.requestedAt;
          if (age > 2000) {
            pendingSectionTransition.current = null;
            return;
          }

          if (pending.direction === "prev" && section?.index !== pending.targetIndex) {
            return;
          }

          if (!doc) return;
          const frame = doc.defaultView?.frameElement as
            | HTMLElement
            | null
            | undefined;
          const container = frame?.closest(".epub-container") as
            | HTMLElement
            | null
            | undefined;
          if (!frame || !container) return;

          const applyBottomAnchor = () => {
            const containerRect = container.getBoundingClientRect();
            const frameRect = frame.getBoundingClientRect();
            const frameTopInContainer =
              container.scrollTop + (frameRect.top - containerRect.top);
            const targetTop = Math.max(
              frameTopInContainer + frameRect.height - container.clientHeight - 24,
              0,
            );
            container.scrollTop = targetTop;
            lastScrollPositions.current.set(container, targetTop);
          };

          // Run on the next paint so frame height is stable.
          requestAnimationFrame(() => {
            applyBottomAnchor();
            pendingSectionTransition.current = null;
          });
        },
      );

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
    },
    [
      applyThemeToDocument,
      applyThemeToRendition,
      applyFontSettingsToRendition,
      attachAutoAdvance,
      attachAutoAdvanceContainer,
    ],
  );

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
