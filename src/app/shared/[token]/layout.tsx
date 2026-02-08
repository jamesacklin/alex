"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SharedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { token: string };
}) {
  const pathname = usePathname();
  const isReader = pathname?.includes(`/shared/${params.token}/read/`);

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
              className="text-xl font-bold hover:text-muted-foreground transition-colors"
            >
              Alex
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
