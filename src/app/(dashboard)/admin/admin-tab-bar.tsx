"use client";

import { usePathname } from "next/navigation";
import {
  SlidingUnderlineTabs,
  type SlidingUnderlineTabItem,
} from "@/components/navigation/SlidingUnderlineTabs";

const ADMIN_NAV: SlidingUnderlineTabItem[] = [
  {
    label: "Users",
    href: "/admin/users",
    match: "prefix",
  },
  {
    label: "Library",
    href: "/admin/library",
    match: "prefix",
  },
];

export function AdminTabBar() {
  const pathname = usePathname();

  return <SlidingUnderlineTabs items={ADMIN_NAV} activeHref={pathname} />;
}
