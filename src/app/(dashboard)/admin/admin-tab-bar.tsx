"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SettingsNavItem {
  label: string;
  href: string;
  adminOnly?: boolean;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  {
    label: "General",
    href: "/admin/general",
  },
  {
    label: "Users",
    href: "/admin/users",
    adminOnly: true,
  },
  {
    label: "Library",
    href: "/admin/library",
    adminOnly: true,
  },
];

export function SettingsTabBar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visibleItems = SETTINGS_NAV.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
