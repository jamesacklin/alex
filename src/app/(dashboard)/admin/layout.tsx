"use client";

import { usePathname } from "next/navigation";
import { AdminTabBar } from "./admin-tab-bar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <AdminTabBar />

      <div key={pathname} className="dashboard-screen-fade">
        {children}
      </div>
    </div>
  );
}
