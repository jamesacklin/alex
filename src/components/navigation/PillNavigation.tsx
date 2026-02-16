"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface PillNavItem {
  label: string;
  href: string;
  match?: "exact" | "prefix";
}

interface PillNavigationProps {
  items: PillNavItem[];
  className?: string;
}

function isItemActive(pathname: string, href: string, match: "exact" | "prefix" = "prefix") {
  if (match === "exact") {
    return pathname === href;
  }
  const base = `/${href.split("/").filter(Boolean)[0] ?? ""}`;
  return (
    pathname === href ||
    (base !== "/" && (pathname === base || pathname.startsWith(`${base}/`)))
  );
}

export function PillNavigation({ items, className }: PillNavigationProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary navigation"
      className={cn("flex items-center gap-1.5", className)}
    >
      {items.map((item) => {
        const active = isItemActive(pathname, item.href, item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
