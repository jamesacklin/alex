import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authSession as auth } from "@/lib/auth/config";
import { execute, queryAll, queryOne } from "@/lib/db/rust";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await queryAll<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    createdAt: number;
    updatedAt: number;
  }>(
    `
      SELECT
        id,
        email,
        display_name AS displayName,
        role,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM users
      ORDER BY created_at ASC
    `
  );

  return NextResponse.json({ users: allUsers });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, displayName, password, role } = await req.json();

  if (!email || !displayName || !password) {
    return NextResponse.json(
      { error: "Email, display name, and password are required" },
      { status: 400 }
    );
  }

  if (!["admin", "user"].includes(role)) {
    return NextResponse.json({ error: "Role must be 'admin' or 'user'" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = ?1
      LIMIT 1
    `,
    [email]
  );
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [id, email, passwordHash, displayName, role, now, now]
  );

  return NextResponse.json(
    { user: { id, email, displayName, role, createdAt: now, updatedAt: now } },
    { status: 201 }
  );
}

