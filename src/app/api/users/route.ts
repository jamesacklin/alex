import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

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
      { status: 400 },
    );
  }

  if (!["admin", "user"].includes(role)) {
    return NextResponse.json(
      { error: "Role must be 'admin' or 'user'" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await db.insert(users).values({
    id,
    email,
    passwordHash,
    displayName,
    role,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json(
    { user: { id, email, displayName, role, createdAt: now, updatedAt: now } },
    { status: 201 },
  );
}
