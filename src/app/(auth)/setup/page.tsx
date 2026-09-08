import { redirect } from "next/navigation";
import { anyUserExists, ensureSetupToken, setupTokenPath } from "@/lib/auth/bootstrap";
import SetupForm from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await anyUserExists()) {
    redirect("/login");
  }

  // Mint (and log) the one-time bootstrap token if this is the first visit.
  // The value is never sent to the browser — only the location to find it.
  await ensureSetupToken();

  return <SetupForm tokenLocation={setupTokenPath()} />;
}
