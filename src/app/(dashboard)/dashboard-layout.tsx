"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { AppLogo } from "@/components/branding/AppLogo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [showNukeDialog, setShowNukeDialog] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const q = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(q);
  const showLibrarySearch =
    pathname === "/library" || pathname.startsWith("/library/");

  const navItems =
    user.role === "admin" ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  const handleChangeLibraryPath = async () => {
    if (!window.electronAPI || isProcessing) return;
    setIsProcessing(true);
    try {
      const newPath = await window.electronAPI.selectLibraryPath();
      if (newPath) {
        toast.success("Library directory changed", {
          description: "Books cleared and library will be re-indexed",
        });
        // Backend waits before restarting watcher, safe to refresh now
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to change library path:", error);
      toast.error("Failed to change library directory");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRescan = async () => {
    if (!window.electronAPI || isProcessing) return;
    setIsProcessing(true);
    try {
      const success = await window.electronAPI.rescanLibrary();
      if (success) {
        toast.info("Library rescan started", {
          description: "Scanning for new books...",
        });
      }
    } catch (error) {
      console.error("Failed to rescan library:", error);
      toast.error("Failed to rescan library");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNukeAndRescan = async () => {
    if (!window.electronAPI || isProcessing) return;
    setIsProcessing(true);
    try {
      const success = await window.electronAPI.nukeAndRescanLibrary();
      setShowNukeDialog(false);
      if (success) {
        toast.success("Library cleared", {
          description: "All books removed. Re-scanning directory...",
        });
        // Backend waits before restarting watcher, safe to refresh now
        router.refresh();
      } else {
        toast.error("Failed to clear library");
      }
    } catch (error) {
      console.error("Failed to nuke and rescan library:", error);
      toast.error("Failed to clear library");
    } finally {
      setIsProcessing(false);
    }
  };

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
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    if (!showLibrarySearch) return;
    if (searchInput === q) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(paramsString);
      if (searchInput) params.set("q", searchInput);
      else params.delete("q");
      params.delete("page");
      router.push(`/library${params.toString() ? `?${params}` : ""}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [paramsString, q, router, searchInput, showLibrarySearch]);

  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar text-sidebar-foreground px-5">
        <div className="flex items-center gap-3 min-w-[180px]">
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
          <AppLogo className="shrink-0 text-sidebar-foreground" />
          <span className="text-sm font-medium tracking-wide">Alex</span>
        </div>

        <div className="flex-1 flex justify-center">
          {showLibrarySearch && (
            <div className="relative w-full max-w-md">
              <button
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => {
                  const params = new URLSearchParams(paramsString);
                  if (searchInput) params.set("q", searchInput);
                  else params.delete("q");
                  params.delete("page");
                  router.push(
                    `/library${params.toString() ? `?${params}` : ""}`,
                  );
                }}
                aria-label="Search"
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
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </button>
              <Input
                type="text"
                placeholder="Search by title or author…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const params = new URLSearchParams(paramsString);
                    if (searchInput) params.set("q", searchInput);
                    else params.delete("q");
                    params.delete("page");
                    router.push(
                      `/library${params.toString() ? `?${params}` : ""}`,
                    );
                  }
                }}
                className="h-8 bg-background text-foreground pl-8 pr-8"
              />
              {searchInput && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
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
              )}
            </div>
          )}
        </div>

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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
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
          <nav className="flex-1 overflow-y-auto flex flex-col">
            <div className="flex-1">
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

            {/* Library Settings (Electron only) */}
            {isElectron && (
              <div className="border-t border-sidebar-border mt-auto">
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2">
                    Library
                  </div>
                  <button
                    onClick={handleChangeLibraryPath}
                    disabled={isProcessing}
                    className="w-full flex items-center gap-3 px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                    </svg>
                    Change directory
                  </button>
                  <button
                    onClick={handleRescan}
                    disabled={isProcessing}
                    className="w-full flex items-center gap-3 px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg
                      className={`h-4 w-4 ${isProcessing ? "animate-spin" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 16h5v5" />
                    </svg>
                    Rescan
                  </button>
                  <button
                    onClick={() => setShowNukeDialog(true)}
                    disabled={isProcessing}
                    className="w-full flex items-center gap-3 px-2 py-2 text-sm text-destructive hover:bg-destructive/10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                    Clear and rescan
                  </button>
                </div>
              </div>
            )}
          </nav>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Page content */}
          <main className="flex-1 overflow-auto p-6 md:p-8">{children}</main>
        </div>
      </div>

      {/* Nuke confirmation dialog */}
      <AlertDialog open={showNukeDialog} onOpenChange={setShowNukeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear library and rescan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all books from the library database and rescan
              your library directory. Your collections and reading progress will
              be preserved, but books will need to be re-indexed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleNukeAndRescan}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear and rescan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
