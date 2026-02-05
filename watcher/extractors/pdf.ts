import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { PDFParse } from "pdf-parse";
import { createCanvas } from "canvas";
import type { BookMetadata } from "../types";

// --- one-time detection: is pdftoppm available? ---
let hasPdftoppm: boolean | null = null;
function detectPdftoppm(): boolean {
  if (hasPdftoppm !== null) return hasPdftoppm;
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "pipe" });
    hasPdftoppm = true;
  } catch {
    hasPdftoppm = false;
  }
  return hasPdftoppm;
}

// --- primary: render page 1 via poppler ---
function renderWithPdftoppm(filePath: string, bookId: string, coversDir: string): string | undefined {
  try {
    const outPrefix = path.join(coversDir, bookId);
    execFileSync("pdftoppm", [
      "-jpeg", "-r", "150", "-singlefile", "-f", "1", "-l", "1",
      filePath, outPrefix,
    ]);
    const coverPath = `${outPrefix}.jpg`;
    return fs.existsSync(coverPath) ? coverPath : undefined;
  } catch {
    return undefined;
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

function generateCover(filePath: string, bookId: string, title: string, author: string | undefined): string | undefined {
  const coversDir = path.resolve("data/covers");
  fs.mkdirSync(coversDir, { recursive: true });

  if (detectPdftoppm()) {
    return renderWithPdftoppm(filePath, bookId, coversDir);
  }
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

  const coverPath = generateCover(filePath, bookId, title, author);

  return { title, author, pageCount, coverPath };
}
