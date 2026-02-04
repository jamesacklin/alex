import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import DashboardLayout from "./dashboard-layout";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardLayout user={session.user}>{children}</DashboardLayout>
  );
}
