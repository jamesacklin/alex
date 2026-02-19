import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { SqlParam, queryAll, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const type = url.searchParams.get("type") || "all";
  const status = url.searchParams.get("status") || "all";
  const sort = url.searchParams.get("sort") || "added";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 24));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const whereParams: SqlParam[] = [];

  if (q) {
    whereClauses.push("(b.title LIKE ? OR b.author LIKE ?)");
    const likePattern = `%${q}%`;
    whereParams.push(likePattern, likePattern);
  }

  if (type !== "all") {
    whereClauses.push("b.file_type = ?");
    whereParams.push(type);
  }

  if (status === "not_started") {
    whereClauses.push("(rp.status IS NULL OR rp.status = 'not_started')");
  } else if (status === "reading") {
    whereClauses.push("rp.status = ?");
    whereParams.push("reading");
  } else if (status === "completed") {
    whereClauses.push("rp.status = ?");
    whereParams.push("completed");
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const orderBy = (() => {
    switch (sort) {
      case "title":
        return "b.title ASC";
      case "author":
        return "b.author ASC";
      case "read":
        return "rp.last_read_at DESC";
      default:
        return "b.added_at DESC";
    }
  })();

  const countRow = await queryOne<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM books b
      LEFT JOIN reading_progress rp
        ON rp.book_id = b.id
       AND rp.user_id = ?
      ${whereSql}
    `,
    [session.user.id, ...whereParams]
  );
  const total = Number(countRow?.total ?? 0);

  const rows = await queryAll<{
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    fileType: string;
    pageCount: number | null;
    addedAt: number;
    updatedAt: number;
    progressStatus: string | null;
    progressPercent: number | null;
    progressLastReadAt: number | null;
  }>(
    `
      SELECT
        b.id,
        b.title,
        b.author,
        b.cover_path AS coverPath,
        b.file_type AS fileType,
        b.page_count AS pageCount,
        b.added_at AS addedAt,
        b.updated_at AS updatedAt,
        rp.status AS progressStatus,
        rp.percent_complete AS progressPercent,
        rp.last_read_at AS progressLastReadAt
      FROM books b
      LEFT JOIN reading_progress rp
        ON rp.book_id = b.id
       AND rp.user_id = ?
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ?
      OFFSET ?
    `,
    [session.user.id, ...whereParams, limit, offset]
  );

  const booksResponse = rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    coverPath: row.coverPath,
    fileType: row.fileType,
    pageCount: row.pageCount,
    updatedAt: row.updatedAt,
    readingProgress:
      row.progressStatus !== null
        ? {
            status: row.progressStatus,
            percentComplete: row.progressPercent,
            lastReadAt: row.progressLastReadAt,
          }
        : null,
  }));

  return NextResponse.json({
    books: booksResponse,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  });
}

