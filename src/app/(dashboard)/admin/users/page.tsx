import { authSession as auth } from "@/lib/auth/config";
import { queryAll } from "@/lib/db/rust";
import UsersTable from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth();

  const allUsers = await queryAll<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    createdAt: number;
  }>(
    `
      SELECT
        id,
        email,
        display_name AS displayName,
        role,
        created_at AS createdAt
      FROM users
      ORDER BY created_at ASC
    `
  );

  return (
    <UsersTable
      users={allUsers}
      currentUserId={session?.user?.id ?? ""}
      actionsContainerId="settings-actions"
    />
  );
}
