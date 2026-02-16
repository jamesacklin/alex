"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { AppLogo } from "@/components/branding/AppLogo";
import { FloatingTabBar } from "@/components/navigation/FloatingTabBar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const ADMIN_NAV_ITEM: NavItem = {
  label: "Admin",
  href: "/admin/users",
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
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

export default function DashboardLayout({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const transitionScopeKey = pathname.startsWith("/admin") ? "/admin" : pathname;
  const navItems =
    user.role === "admin" ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
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

  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar text-sidebar-foreground px-5">
        <div className="flex items-center gap-3 min-w-[180px]">
          <AppLogo className="shrink-0 text-sidebar-foreground" />
          <span className="text-sm font-medium tracking-wide">Alex</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center justify-end min-w-[180px]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild suppressHydrationWarning>
              <Button
                variant="link"
                className="gap-2 px-2 text-sidebar-foreground"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-sm bg-sidebar-foreground text-sidebar">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm hidden sm:inline">
                  {user.displayName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium text-sm">{user.displayName}</div>
                <div className="text-sm text-muted-foreground">
                  {user.email}
                </div>
              </DropdownMenuLabel>
              {process.env.NEXT_PUBLIC_ALEX_DESKTOP !== 'true' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => signOut({ redirectTo: "/login" })}
                    className="text-destructive focus:text-destructive cursor-pointer"
                  >
                    <svg
                      className="h-4 w-4 mr-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Log out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 md:p-8 pb-28 md:pb-32">
        <div key={transitionScopeKey} className="dashboard-screen-fade">
          {children}
        </div>
      </main>

      <FloatingTabBar items={floatingNavItems} />
    </div>
  );
}
