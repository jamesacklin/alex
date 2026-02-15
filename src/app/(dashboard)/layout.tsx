import { Suspense } from "react";
import { authSession as auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import DashboardLayout from "./dashboard-layout";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // In desktop mode, authSession should return a synthetic session
  // If it doesn't, something is wrong - log and continue anyway to avoid redirect loop
  if (!session?.user) {
    if (process.env.ALEX_DESKTOP === 'true') {
      console.error('[Dashboard Layout] Desktop mode but no session - this should not happen');
      // Continue anyway in desktop mode rather than redirecting
    } else {
      redirect("/login");
    }
  }

  return (
    <Suspense>
      <DashboardLayout user={session?.user ?? { id: '1', email: 'admin@localhost', displayName: 'Admin', role: 'admin' }}>{children}</DashboardLayout>
    </Suspense>
  );
}
