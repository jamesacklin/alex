import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";
import { asc } from "drizzle-orm";
import UsersTable from "./users-table";

export default async function UsersPage() {
  const session = await auth();

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">User Management</h1>
      <UsersTable users={allUsers} currentUserId={session?.user?.id ?? ""} />
    </div>
  );
}
