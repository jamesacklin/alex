import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db/rust";
import SetupForm from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM users
      LIMIT 1
    `
  );

  if (existing) {
    redirect("/login");
  }

  return <SetupForm />;
}
