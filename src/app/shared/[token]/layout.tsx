"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppLogo } from "@/components/branding/AppLogo";

export default function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isReader = pathname
    ? /^\/shared\/[^/]+\/read(\/|$)/.test(pathname)
    : false;

  if (isReader) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Minimal header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-semibold hover:text-muted-foreground transition-colors"
            >
              <AppLogo className="h-6 w-6" />
              <span>Alex</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="container mx-auto max-w-7xl px-4 py-8">{children}</div>
      </main>
    </div>
  );
}
