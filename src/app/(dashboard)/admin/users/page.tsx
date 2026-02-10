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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">User Management</h1>
        <div id="users-table-actions" />
      </div>
      <UsersTable
        users={allUsers}
        currentUserId={session?.user?.id ?? ""}
        actionsContainerId="users-table-actions"
      />
    </div>
  );
}
