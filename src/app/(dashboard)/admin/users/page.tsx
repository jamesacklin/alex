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
    disabledAt: number | null;
    canSignIn: number;
  }>(
    `
      SELECT
        id,
        email,
        display_name AS displayName,
        role,
        created_at AS createdAt,
        disabled_at AS disabledAt,
        -- Whether this account has a usable password at all. The synthetic
        -- desktop principal deliberately does not (see src/lib/auth/password.ts),
        -- and saying so is clearer than showing it as a normal account.
        CASE WHEN password_hash LIKE '$2%' THEN 1 ELSE 0 END AS canSignIn
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
