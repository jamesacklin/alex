import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { authSession as auth } from "@/lib/auth/config";
import { asc } from "drizzle-orm";
import UsersTable from "./users-table";

export const dynamic = "force-dynamic";

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
    <UsersTable
      users={allUsers}
      currentUserId={session?.user?.id ?? ""}
      actionsContainerId="settings-actions"
    />
  );
}
