"use client";

import { usePathname } from "next/navigation";
import { SettingsTabBar } from "./admin-tab-bar";

export function SettingsLayoutClient({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <SettingsTabBar isAdmin={isAdmin} />
        <div id="settings-actions" />
      </div>

      <div key={pathname} className="dashboard-screen-fade">
        {children}
      </div>
    </div>
  );
}
