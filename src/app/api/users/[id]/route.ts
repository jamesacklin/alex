import { NextResponse } from "next/server";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (session.user.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const user = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE id = ?1
      LIMIT 1
    `,
    [id]
  );

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await execute("DELETE FROM users WHERE id = ?1", [id]);

  return NextResponse.json({ success: true });
}

