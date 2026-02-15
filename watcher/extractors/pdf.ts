import path from "path";
import fs from "fs";
import { PDFParse } from "pdf-parse";
import { createCanvas } from "canvas";
import type { BookMetadata } from "../types";

interface PDFDocument {
  getPage(pageNum: number): Promise<PDFPage>;
  destroy(): void;
}

interface PDFPage {
  getViewport(params: { scale: number }): PDFViewport;
  render(params: { canvasContext: unknown; viewport: PDFViewport }): { promise: Promise<void> };
}

interface PDFViewport {
  width: number;
  height: number;
}

interface CanvasAndContext {
  canvas: {
    width: number;
    height: number;
    toBuffer(type: string, options?: { quality: number }): Buffer;
  };
  context: unknown;
}

// --- primary: render page 1 via pdfjs-dist + node-canvas ---
async function renderWithPdfjs(filePath: string, bookId: string, coversDir: string): Promise<string | undefined> {
  let pdfDoc: PDFDocument | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");

    // Resolve resource paths from the installed package
    const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const cMapUrl = path.join(pdfjsPkgDir, "cmaps") + path.sep;
    const standardFontDataUrl = path.join(pdfjsPkgDir, "standard_fonts") + path.sep;

    // Custom CanvasFactory using node-canvas (pdfjs expects this interface)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas: createNodeCanvas } = require("canvas");
    class NodeCanvasFactory {
      create(width: number, height: number): CanvasAndContext {
        const canvas = createNodeCanvas(width, height);
        const context = canvas.getContext("2d");
        return { canvas, context };
      }
      reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
      }
      destroy(canvasAndContext: CanvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        // Clear references for garbage collection
        (canvasAndContext as { canvas: unknown; context: unknown }).canvas = null;
        (canvasAndContext as { canvas: unknown; context: unknown }).context = null;
      }
    }

    const data = new Uint8Array(fs.readFileSync(filePath));

    pdfDoc = await pdfjsLib.getDocument({
      data,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      canvasFactory: new NodeCanvasFactory(),
      isEvalSupported: false,
      disableWorker: true,
    }).promise;

    if (!pdfDoc) {
      throw new Error("Failed to load PDF document");
    }

    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 150 / 72 }); // 150 DPI

    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;

    const coverPath = path.join(coversDir, `${bookId}.jpg`);
    const jpegBuffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
    fs.writeFileSync(coverPath, jpegBuffer);

    return coverPath;
  } catch (err) {
    console.error("[pdf] pdfjs-dist render failed:", err);
    return undefined;
  } finally {
    if (pdfDoc) {
      try {
        pdfDoc.destroy();
      } catch {
        // Suppress cleanup errors - already in error state
      }
    }
  }
}

// --- fallback: synthetic cover with title + author ---
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charWidth = fontSize * 0.6;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidth));
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderSynthetic(bookId: string, title: string, author: string | undefined, coversDir: string): string | undefined {
  try {
    const W = 400, H = 600;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#1e1b4b");
    grad.addColorStop(1, "#312e81");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#6366f1";
    ctx.fillRect(0, 0, W, 5);

    const titleFontSize = 34;
    const titleLines = wrapText(title, W - 80, titleFontSize);
    const lineHeight = titleFontSize * 1.3;
    const blockHeight = titleLines.length * lineHeight + (author ? 36 : 0);
    let y = (H - blockHeight) / 2 + titleFontSize;

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${titleFontSize}px sans-serif`;
    ctx.textAlign = "center";
    for (const line of titleLines) {
      ctx.fillText(line, W / 2, y);
      y += lineHeight;
    }

    if (author) {
      ctx.fillStyle = "#a5b4fc";
      ctx.font = `20px sans-serif`;
      ctx.fillText(author, W / 2, y + 16);
    }

    const coverPath = path.join(coversDir, `${bookId}.jpg`);
    fs.writeFileSync(coverPath, canvas.toBuffer("image/jpeg", { quality: 0.9 }));
    return coverPath;
  } catch {
    return undefined;
  }
}

async function generateCover(filePath: string, bookId: string, title: string, author: string | undefined): Promise<string | undefined> {
  const coversDir = path.resolve(process.env.COVERS_PATH ?? "data/covers");
  fs.mkdirSync(coversDir, { recursive: true });

  // Primary: pdfjs-dist + node-canvas (no system deps)
  const pdfjsCover = await renderWithPdfjs(filePath, bookId, coversDir);
  if (pdfjsCover) return pdfjsCover;

  // Fallback: synthetic gradient cover
  return renderSynthetic(bookId, title, author, coversDir);
}

export async function extractPdfMetadata(filePath: string, bookId: string): Promise<BookMetadata> {
  const titleFallback = path.basename(filePath, path.extname(filePath));

  let title = titleFallback;
  let author: string | undefined;
  let pageCount: number | undefined;

  try {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo();
    await parser.destroy();

    title = info.info?.Title?.trim() || titleFallback;
    author = info.info?.Author?.trim() || undefined;
    pageCount = info.total > 0 ? info.total : undefined;
  } catch {
    // metadata extraction failed — title stays as filename fallback
  }

  const coverPath = await generateCover(filePath, bookId, title, author);

  return { title, author, pageCount, coverPath };
}
