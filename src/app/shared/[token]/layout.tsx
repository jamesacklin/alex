import Link from "next/link";

export default function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

      {/* Minimal footer */}
      <footer className="border-t bg-muted/30 py-6 mt-12">
        <div className="container mx-auto max-w-7xl px-4">
          <div className="flex justify-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Alex. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
