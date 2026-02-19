import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

function getOrigin(req: Request) {
  return new URL(req.url).origin;
}

// POST /api/collections/[id]/share — enable sharing
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const collection = await queryOne<{ id: string; shareToken: string | null }>(
    `
      SELECT
        id,
        share_token AS shareToken
      FROM collections
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  if (collection.shareToken) {
    const shareUrl = `${getOrigin(req)}/shared/${collection.shareToken}`;
    return NextResponse.json({
      shareToken: collection.shareToken,
      shareUrl,
    });
  }

  const shareToken = crypto.randomUUID();
  const sharedAt = Math.floor(Date.now() / 1000);

  await execute(
    `
      UPDATE collections
      SET share_token = ?1,
          shared_at = ?2
      WHERE id = ?3
        AND user_id = ?4
    `,
    [shareToken, sharedAt, id, session.user.id]
  );

  const shareUrl = `${getOrigin(req)}/shared/${shareToken}`;

  return NextResponse.json({
    shareToken,
    shareUrl,
  });
}

// DELETE /api/collections/[id]/share — disable sharing
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const collection = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM collections
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  await execute(
    `
      UPDATE collections
      SET share_token = NULL,
          shared_at = NULL
      WHERE id = ?1
        AND user_id = ?2
    `,
    [id, session.user.id]
  );

  return NextResponse.json({ success: true });
}

// GET /api/collections/[id]/share — check sharing status
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const collection = await queryOne<{ shareToken: string | null; sharedAt: number | null }>(
    `
      SELECT
        share_token AS shareToken,
        shared_at AS sharedAt
      FROM collections
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
    [id, session.user.id]
  );

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  return NextResponse.json({
    isShared: collection.shareToken !== null,
    shareToken: collection.shareToken,
    sharedAt: collection.sharedAt,
  });
}

