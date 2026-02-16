import { authSession as auth } from "@/lib/auth/config";
import { GeneralSettingsClient } from "./general-settings-client";

export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  const session = await auth();

  return (
    <GeneralSettingsClient
      displayName={session?.user?.displayName ?? ""}
      email={session?.user?.email ?? ""}
    />
  );
}
