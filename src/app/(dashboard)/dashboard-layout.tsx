"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
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
import { cn } from "@/lib/utils";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const showFloatingTabBar =
    pathname === "/library" ||
    pathname.startsWith("/library/") ||
    pathname === "/collections" ||
    pathname.startsWith("/collections/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");
  const showSidebar = !showFloatingTabBar;

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

  useEffect(() => {
    if (!showSidebar) {
      setSidebarOpen(false);
    }
  }, [showSidebar]);

  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Mobile overlay */}
      {showSidebar && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar text-sidebar-foreground px-5">
        <div className="flex items-center gap-3 min-w-[180px]">
          {showSidebar && (
            <button
              className="md:hidden text-sidebar-foreground"
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
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

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {showSidebar && (
          <aside
            className={[
              "fixed top-14 bottom-0 left-0 z-50 w-56 bg-sidebar border-r border-sidebar-border flex flex-col",
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
              "md:relative md:translate-x-0 md:inset-y-0",
            ].join(" ")}
          >
            <div className="md:hidden flex h-14 shrink-0 items-center justify-end px-5 border-b border-sidebar-border">
              <button
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close sidebar"
                onClick={() => setSidebarOpen(false)}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto">
              <div>
                {navItems.map((item) => {
                  const itemBase = `/${item.href.split("/").filter(Boolean)[0] ?? ""}`;
                  const isActive =
                    pathname === item.href ||
                    (itemBase !== "/" &&
                      (pathname === itemBase ||
                        pathname.startsWith(`${itemBase}/`)));

                  if (item.comingSoon) {
                    return (
                      <div
                        key={item.href}
                        className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-muted-foreground opacity-60 cursor-not-allowed border-l-2 border-transparent"
                      >
                        {item.icon}
                        <span className="flex-1">{item.label}</span>
                        <span className="px-1.5 py-0.5 text-sm font-semibold bg-muted text-muted-foreground border border-border">
                          SOON
                        </span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={[
                        "flex items-center gap-3 px-5 py-3 text-sm font-medium border-l-2",
                        isActive
                          ? "border-primary bg-muted font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </aside>
        )}

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Page content */}
          <main
            className={cn(
              "flex-1 overflow-auto p-6 md:p-8",
              showFloatingTabBar && "pb-28 md:pb-32",
            )}
          >
            {children}
          </main>
        </div>
      </div>

      {showFloatingTabBar && <FloatingTabBar items={floatingNavItems} />}
    </div>
  );
}
