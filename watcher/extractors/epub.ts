import path from "path";
import type { BookMetadata } from "../types";

// Full extraction with epub2 is implemented in US-3.6.
// Fallback: derive title from filename.
export async function extractEpubMetadata(filePath: string, _bookId: string): Promise<BookMetadata> {
  const title = path.basename(filePath, path.extname(filePath));
  return { title };
}
