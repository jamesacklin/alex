import { NextResponse } from "next/server";
import fs from "fs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { books } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="200" height="300">
  <rect width="200" height="300" fill="#e2e8f0" rx="4"/>
  <rect x="70" y="90" width="60" height="80" fill="#cbd5e1" rx="2"/>
  <rect x="75" y="95" width="50" height="70" fill="#94a3b8" rx="1"/>
  <rect x="50" y="190" width="100" height="10" fill="#94a3b8" rx="2"/>
  <rect x="65" y="210" width="70" height="8" fill="#cbd5e1" rx="2"/>
</svg>`;

function placeholderResponse() {
  return new NextResponse(PLACEHOLDER_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [book] = await db
    .select({ coverPath: books.coverPath })
    .from(books)
    .where(eq(books.id, id));

  if (!book?.coverPath || !fs.existsSync(book.coverPath)) {
    return placeholderResponse();
  }

  return new NextResponse(fs.readFileSync(book.coverPath), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
