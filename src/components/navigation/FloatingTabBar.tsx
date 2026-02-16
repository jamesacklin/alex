"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export interface FloatingTabBarItem {
  label: string;
  href: string;
  icon: ReactNode;
}

interface FloatingTabBarProps {
  items: FloatingTabBarItem[];
  className?: string;
}

function isItemActive(pathname: string, href: string) {
  const base = `/${href.split("/").filter(Boolean)[0] ?? ""}`;
  return (
    pathname === href ||
    (base !== "/" && (pathname === base || pathname.startsWith(`${base}/`)))
  );
}

export function FloatingTabBar({ items, className }: FloatingTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const isLibraryRoute =
    pathname === "/library" || pathname.startsWith("/library/");
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(q);
  const [activePill, setActivePill] = useState({
    left: 0,
    width: 0,
    visible: false,
  });

  useEffect(() => {
    if (isLibraryRoute) {
      setSearchValue(q);
      if (q) setSearchOpen(true);
    }
  }, [isLibraryRoute, q]);

  useEffect(() => {
    if (!searchOpen) return;
    inputRef.current?.focus();
  }, [searchOpen]);

  const updateActivePill = useCallback(() => {
    if (!tabsRef.current || searchOpen) {
      setActivePill((prev) => ({ ...prev, visible: false }));
      return;
    }

    const activeItem = items.find((item) => isItemActive(pathname, item.href));
    if (!activeItem) {
      setActivePill((prev) => ({ ...prev, visible: false }));
      return;
    }

    const activeNode = itemRefs.current[activeItem.href];
    if (!activeNode) {
      setActivePill((prev) => ({ ...prev, visible: false }));
      return;
    }

    const containerRect = tabsRef.current.getBoundingClientRect();
    const activeRect = activeNode.getBoundingClientRect();

    setActivePill({
      left: activeRect.left - containerRect.left,
      width: activeRect.width,
      visible: true,
    });
  }, [items, pathname, searchOpen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateActivePill);
    return () => window.cancelAnimationFrame(frame);
  }, [updateActivePill]);

  useEffect(() => {
    if (!tabsRef.current) return;

    const observer = new ResizeObserver(() => updateActivePill());
    observer.observe(tabsRef.current);

    for (const item of items) {
      const el = itemRefs.current[item.href];
      if (el) observer.observe(el);
    }

    window.addEventListener("resize", updateActivePill);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateActivePill);
    };
  }, [items, updateActivePill]);

  useEffect(() => {
    if (!isLibraryRoute || !searchOpen) return;
    if (searchValue === q) return;

    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue.trim()) params.set("q", searchValue.trim());
      else params.delete("q");
      params.delete("page");
      router.replace(`/library${params.toString() ? `?${params}` : ""}`, {
        scroll: false,
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [isLibraryRoute, q, router, searchOpen, searchParams, searchValue]);

  const openSearch = () => {
    setSearchOpen(true);
  };

  const navigateToLibrary = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    params.delete("page");
    router.push(`/library${params.toString() ? `?${params}` : ""}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateToLibrary(searchValue);
  };

  const handleCloseOrClear = () => {
    if (searchValue) {
      setSearchValue("");
      if (isLibraryRoute) {
        navigateToLibrary("");
      }
      return;
    }
    setSearchOpen(false);
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-40 w-fit max-w-[calc(100vw-1rem)] -translate-x-1/2 md:bottom-6",
        className,
      )}
    >
      <nav
        aria-label="Primary navigation"
        className="relative flex h-14 w-fit max-w-full items-center overflow-hidden rounded-full border border-border/80 bg-background/90 p-2 shadow-xl shadow-black/10 backdrop-blur-sm"
      >
        <div
          ref={tabsRef}
          className={cn(
            "relative flex items-center gap-1 transition-opacity duration-100 ease-linear",
            searchOpen ? "opacity-0 pointer-events-none" : "opacity-100",
          )}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full bg-foreground transition-[width,transform,opacity] duration-300 ease-out"
            style={{
              width: `${activePill.width}px`,
              transform: `translateX(${activePill.left}px)`,
              opacity: activePill.visible ? 1 : 0,
            }}
          />
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSearchOpen(false)}
              ref={(element) => {
                itemRefs.current[item.href] = element;
              }}
              className={cn(
                "relative z-10 flex h-10 items-center gap-2 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors",
                isItemActive(pathname, item.href)
                  ? "text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div aria-hidden="true" className="ml-1 h-10 w-10 shrink-0" />

        <form
          onSubmit={handleSubmit}
          className={cn(
            "absolute right-2 top-2 flex h-10 items-center overflow-hidden rounded-full border border-border/70 bg-muted/60 transition-[width] duration-300 ease-out",
            searchOpen
              ? "w-[calc(100%-1rem)] px-2"
              : "w-10 justify-center px-0",
          )}
        >
          <button
            type={searchOpen ? "submit" : "button"}
            onClick={searchOpen ? undefined : openSearch}
            aria-label="Search library"
            className={cn(
              "grid shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground",
              searchOpen ? "h-8 w-8" : "h-10 w-10 cursor-pointer",
            )}
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
          <input
            ref={inputRef}
            type="text"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            onFocus={openSearch}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                handleCloseOrClear();
              }
            }}
            placeholder="Search library"
            className={cn(
              "h-8 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground transition-[width,opacity] duration-200",
              searchOpen
                ? "flex-1 opacity-100"
                : "pointer-events-none w-0 flex-none opacity-0",
            )}
          />
          <button
            type="button"
            onClick={handleCloseOrClear}
            aria-label={searchValue ? "Clear search" : "Close search"}
            className={cn(
              "grid shrink-0 place-items-center rounded-full text-muted-foreground transition-[width,opacity] duration-200 hover:text-foreground cursor-pointer",
              searchOpen
                ? "h-8 w-8 opacity-100"
                : "pointer-events-none h-8 w-0 opacity-0",
            )}
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
        </form>
      </nav>
    </div>
  );
}
