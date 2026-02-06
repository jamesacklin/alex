"use client";

import { useEffect, useRef } from "react";

interface UseInfiniteScrollOptions {
  onLoadMore: () => void | Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  threshold?: number; // pixels from bottom, default 400
  enabled?: boolean; // allow disabling, default true
}

export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  threshold = 400,
  enabled = true,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !hasMore || isLoading) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    // Fallback if IntersectionObserver is not supported
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;

        // Only trigger if intersecting and enough time has passed (debounce)
        if (entry.isIntersecting && !isLoading && hasMore) {
          const now = Date.now();
          if (now - lastTriggerRef.current > 300) {
            lastTriggerRef.current = now;
            onLoadMore();
          }
        }
      },
      {
        root: null,
        rootMargin: `${threshold}px`,
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [enabled, hasMore, isLoading, onLoadMore, threshold]);

  return { sentinelRef };
}
