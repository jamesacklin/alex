export type SavedEpubProgress = {
  epubLocation?: string;
  percentComplete?: number | null;
  scrollFraction?: number | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
};

export type PendingScrollRestore = {
  fraction: number;
  viewportWidth: number;
  viewportHeight: number;
};

export function getPendingScrollRestore(
  saved: SavedEpubProgress,
): PendingScrollRestore | null {
  if (typeof saved.scrollFraction !== "number") return null;
  if (!Number.isFinite(saved.scrollFraction)) return null;
  if (saved.scrollFraction < 0 || saved.scrollFraction > 1) return null;
  if (typeof saved.viewportWidth !== "number") return null;
  if (typeof saved.viewportHeight !== "number") return null;
  if (!Number.isFinite(saved.viewportWidth)) return null;
  if (!Number.isFinite(saved.viewportHeight)) return null;

  return {
    fraction: saved.scrollFraction,
    viewportWidth: saved.viewportWidth,
    viewportHeight: saved.viewportHeight,
  };
}

export function doesViewportMatchSaved(
  pending: PendingScrollRestore,
  viewportWidth: number,
  viewportHeight: number,
  tolerancePx = 2,
): boolean {
  return (
    Math.abs(pending.viewportWidth - viewportWidth) <= tolerancePx &&
    Math.abs(pending.viewportHeight - viewportHeight) <= tolerancePx
  );
}
