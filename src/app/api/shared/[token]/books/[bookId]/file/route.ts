import { NextResponse } from "next/server";
import { getSharedBook } from "@/lib/shared";
import { serveBookFile } from "@/lib/files/serve-book-file";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; bookId: string }> }
) {
  const { token, bookId } = await params;

  const book = await getSharedBook(token, bookId);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  return await serveBookFile(book, req, {
    cacheControl: "private, max-age=3600, must-revalidate",
  });
}
