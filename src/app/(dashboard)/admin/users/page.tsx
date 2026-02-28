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

  // For web/docker deployments, expose the configured server URL.
  // In Electron mode, the client-side component fetches LAN IPs via electronAPI.
  const isElectron = process.env.ALEX_DESKTOP === "true";
  const webServerUrl = isElectron
    ? null
    : (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? null);

  return (
    <UsersTable
      users={allUsers}
      currentUserId={session?.user?.id ?? ""}
      actionsContainerId="settings-actions"
      webServerUrl={webServerUrl}
    />
  );
}
