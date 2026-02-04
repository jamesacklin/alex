import path from "path";
import type { BookMetadata } from "../types";

// Full extraction with pdf-parse is implemented in US-3.5.
// Fallback: derive title from filename.
export async function extractPdfMetadata(filePath: string, _bookId: string): Promise<BookMetadata> {
  const title = path.basename(filePath, path.extname(filePath));
  return { title };
}
