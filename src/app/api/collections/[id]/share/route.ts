import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authSession as auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { collections } from "@/lib/db/schema";

export const dynamic = 'force-dynamic';

function getOrigin(req: Request) {
  return new URL(req.url).origin;
}

// POST /api/collections/[id]/share — enable sharing
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify user owns the collection
  const [collection] = await db
    .select({
      id: collections.id,
      shareToken: collections.shareToken,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  // If already shared, return existing token
  if (collection.shareToken) {
    const shareUrl = `${getOrigin(req)}/shared/${collection.shareToken}`;
    return NextResponse.json({
      shareToken: collection.shareToken,
      shareUrl,
    });
  }

  // Generate new share token
  const shareToken = crypto.randomUUID();
  const sharedAt = Math.floor(Date.now() / 1000);

  await db
    .update(collections)
    .set({ shareToken, sharedAt })
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  const shareUrl = `${getOrigin(req)}/shared/${shareToken}`;

  return NextResponse.json({
    shareToken,
    shareUrl,
  });
}

// DELETE /api/collections/[id]/share — disable sharing
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify user owns the collection
  const [collection] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  // Disable sharing
  await db
    .update(collections)
    .set({ shareToken: null, sharedAt: null })
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  return NextResponse.json({ success: true });
}

// GET /api/collections/[id]/share — check sharing status
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify user owns the collection and get share status
  const [collection] = await db
    .select({
      shareToken: collections.shareToken,
      sharedAt: collections.sharedAt,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, session.user.id)));

  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  return NextResponse.json({
    isShared: collection.shareToken !== null,
    shareToken: collection.shareToken,
    sharedAt: collection.sharedAt,
  });
}
