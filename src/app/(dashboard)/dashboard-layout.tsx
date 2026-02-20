"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FloatingTabBar } from "@/components/navigation/FloatingTabBar";
import { AppLogo } from "@/components/branding/AppLogo";
import { getScreenTitle } from "@/lib/screen-title";

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Library",
    href: "/library",
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    label: "Collections",
    href: "/collections",
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
];

const SETTINGS_ICON = (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export default function DashboardLayout({
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isElectron, setIsElectron] = useState(
    process.env.NEXT_PUBLIC_ALEX_DESKTOP === "true",
  );
  const transitionScopeKey = pathname.startsWith("/admin") ? "/admin" : pathname;
  const screenTitle = getScreenTitle(pathname);

  const navItems: NavItem[] = [
    ...NAV_ITEMS,
    {
      label: "Settings",
      href: isElectron ? "/admin/users" : "/admin/general",
      icon: SETTINGS_ICON,
    },
  ];
  const floatingNavItems = navItems.filter((item) => !item.comingSoon);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    const electron = typeof window !== "undefined" && !!window.electronAPI;
    if (electron) {
      setIsElectron(true);
    }
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background">
      <main className="flex-1 overflow-auto p-6 md:p-8 pb-28 md:pb-32">
        <div key={transitionScopeKey} className="dashboard-screen-fade">
          {/* Screen Title */}
          <div className="mb-6 flex items-center gap-3">
            <AppLogo className="h-8 w-8" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {screenTitle}
            </h1>
          </div>

          {children}
        </div>
      </main>

      <FloatingTabBar items={floatingNavItems} />
    </div>
  );
}
