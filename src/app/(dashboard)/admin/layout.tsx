import { authSession as auth } from "@/lib/auth/config";
import { SettingsLayoutClient } from "./settings-layout-client";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  return (
    <SettingsLayoutClient isAdmin={isAdmin}>{children}</SettingsLayoutClient>
  );
}
