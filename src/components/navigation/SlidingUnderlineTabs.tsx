"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SlidingUnderlineTabItem {
  label: string;
  href: string;
  match?: "exact" | "prefix";
}

interface SlidingUnderlineTabsProps {
  items: SlidingUnderlineTabItem[];
  activeHref: string;
  className?: string;
  tabsClassName?: string;
  tabClassName?: string;
  activeTabClassName?: string;
  inactiveTabClassName?: string;
  underlineClassName?: string;
}

function isItemActive(activeHref: string, item: SlidingUnderlineTabItem) {
  if (item.match === "prefix") {
    return activeHref === item.href || activeHref.startsWith(`${item.href}/`);
  }

  return activeHref === item.href;
}

export function SlidingUnderlineTabs({
  items,
  activeHref,
  className,
  tabsClassName,
  tabClassName,
  activeTabClassName,
  inactiveTabClassName,
  underlineClassName,
}: SlidingUnderlineTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [activeUnderline, setActiveUnderline] = useState({
    left: 0,
    width: 0,
    visible: false,
  });

  const updateUnderline = useCallback(() => {
    if (!tabsRef.current) {
      setActiveUnderline((prev) => ({ ...prev, visible: false }));
      return;
    }

    const activeItem = items.find((item) => isItemActive(activeHref, item));
    if (!activeItem) {
      setActiveUnderline((prev) => ({ ...prev, visible: false }));
      return;
    }

    const activeNode = itemRefs.current[activeItem.href];
    if (!activeNode) {
      setActiveUnderline((prev) => ({ ...prev, visible: false }));
      return;
    }

    const tabsRect = tabsRef.current.getBoundingClientRect();
    const activeRect = activeNode.getBoundingClientRect();

    setActiveUnderline({
      left: activeRect.left - tabsRect.left,
      width: activeRect.width,
      visible: true,
    });
  }, [activeHref, items]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateUnderline);
    return () => window.cancelAnimationFrame(frame);
  }, [updateUnderline]);

  useEffect(() => {
    if (!tabsRef.current) return;

    const observer = new ResizeObserver(() => updateUnderline());
    observer.observe(tabsRef.current);

    for (const item of items) {
      const element = itemRefs.current[item.href];
      if (element) observer.observe(element);
    }

    window.addEventListener("resize", updateUnderline);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateUnderline);
    };
  }, [items, updateUnderline]);

  return (
    <nav className={cn("border-b border-border", className)}>
      <div ref={tabsRef} className={cn("relative flex gap-6", tabsClassName)}>
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -bottom-px h-0.5 rounded-full bg-primary transition-[width,transform,opacity] duration-300 ease-out",
            underlineClassName,
          )}
          style={{
            width: `${activeUnderline.width}px`,
            transform: `translateX(${activeUnderline.left}px)`,
            opacity: activeUnderline.visible ? 1 : 0,
          }}
        />
        {items.map((item) => {
          const active = isItemActive(activeHref, item);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              ref={(element) => {
                itemRefs.current[item.href] = element;
              }}
              className={cn(
                "relative px-1 py-3 text-sm font-medium transition-colors",
                tabClassName,
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                active ? activeTabClassName : inactiveTabClassName,
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
