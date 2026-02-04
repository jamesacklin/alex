import path from "path";
import fs from "fs";
import { PDFParse } from "pdf-parse";
import type { BookMetadata } from "../types";

export async function extractPdfMetadata(filePath: string, _bookId: string): Promise<BookMetadata> {
  const titleFallback = path.basename(filePath, path.extname(filePath));

  try {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo();
    await parser.destroy();

    const title = info.info?.Title?.trim() || titleFallback;
    const author = info.info?.Author?.trim() || undefined;
    const pageCount = info.total > 0 ? info.total : undefined;

    return { title, author, pageCount };
  } catch {
    return { title: titleFallback };
  }
}
