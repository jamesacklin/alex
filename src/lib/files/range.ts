/**
 * One range contract, shared by the local-disk and S3 drivers (F07).
 *
 * The two used to disagree. Local rejected an end past EOF instead of
 * clamping it, and could ask for a stream ending at -1 on an empty file; S3
 * parsed a suffix range (`bytes=-1024`) as a start-at-zero range, and
 * reported the *returned* length as the total object length, producing
 * nonsense like `Content-Range: bytes 10-14/5`.
 *
 * Behaviour here follows RFC 9110 §14:
 *
 *  - `bytes=a-b`   closed range; `b` is clamped to the last byte.
 *  - `bytes=a-`    open-ended; runs to the last byte.
 *  - `bytes=-n`    suffix; the last `n` bytes, clamped to the whole object.
 *  - A well-formed but unsatisfiable range (start past the end, a zero-length
 *    suffix, any range against an empty object) is 416, and the response
 *    carries `Content-Range: bytes * /size`.
 *  - A malformed or multi-range header is *ignored*, and the full
 *    representation is returned — §14.2 permits this and it is what clients
 *    handle best.
 */

export type ParsedRange =
  | { kind: "closed"; start: number; end: number }
  | { kind: "from"; start: number }
  | { kind: "suffix"; length: number };

export type ResolvedRange =
  | { kind: "full"; start: number; end: number; length: number }
  | { kind: "partial"; start: number; end: number; length: number }
  | { kind: "unsatisfiable" };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parse a `Range` header value.
 *
 * Returns `null` when the header is absent, malformed, or specifies more
 * than one range — all of which mean "ignore it and send the whole thing".
 */
export function parseRangeHeader(header: string | null): ParsedRange | null {
  if (!header) return null;

  const match = header.trim().match(SINGLE_BYTE_RANGE);
  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const length = Number(rawEnd);
    if (!Number.isSafeInteger(length)) return null;
    return { kind: "suffix", length };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;

  if (rawEnd === "") {
    return { kind: "from", start };
  }

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end)) return null;
  return { kind: "closed", start, end };
}

/** Resolve a parsed range against a known object size. */
export function resolveRange(range: ParsedRange | null, size: number): ResolvedRange {
  if (range === null) {
    return size === 0
      ? { kind: "full", start: 0, end: -1, length: 0 }
      : { kind: "full", start: 0, end: size - 1, length: size };
  }

  // No range is satisfiable against an empty representation.
  if (size === 0) return { kind: "unsatisfiable" };

  if (range.kind === "suffix") {
    if (range.length === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - range.length);
    return { kind: "partial", start, end: size - 1, length: size - start };
  }

  if (range.start >= size) return { kind: "unsatisfiable" };

  if (range.kind === "from") {
    return { kind: "partial", start: range.start, end: size - 1, length: size - range.start };
  }

  if (range.end < range.start) return { kind: "unsatisfiable" };

  // An end past the last byte is clamped, not rejected.
  const end = Math.min(range.end, size - 1);
  return { kind: "partial", start: range.start, end, length: end - range.start + 1 };
}

/** Canonical `Range` header value for a resolved partial range. */
export function rangeHeaderValue(resolved: Extract<ResolvedRange, { kind: "partial" }>): string {
  return `bytes=${resolved.start}-${resolved.end}`;
}

/** Canonical `Content-Range` for a resolved partial range. */
export function contentRangeValue(
  resolved: Extract<ResolvedRange, { kind: "partial" }>,
  size: number,
): string {
  return `bytes ${resolved.start}-${resolved.end}/${size}`;
}

/** Canonical `Content-Range` for a 416 response. */
export function unsatisfiableContentRange(size: number): string {
  return `bytes */${size}`;
}
