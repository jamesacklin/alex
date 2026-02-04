import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import SetupForm from "./setup-form";

export default async function SetupPage() {
  const [existing] = await db.select().from(users).limit(1);

  if (existing) {
    redirect("/login");
  }

  return <SetupForm />;
}
