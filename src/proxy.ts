import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/middleware-auth";

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const isAuthenticated = !!session;

  // Public pages — no auth required.
  // /setup's own page checks whether users exist and redirects if so.
  if (nextUrl.pathname === "/login" || nextUrl.pathname === "/setup") {
    return NextResponse.next();
  }

  // Public shared collection pages — no auth required.
  // Token validation happens within the page/API endpoints.
  if (nextUrl.pathname.startsWith("/shared/")) {
    return NextResponse.next();
  }

  // NextAuth internals — always pass through.
  if (nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Public shared collection API endpoints — no auth required.
  // Token validation happens within each endpoint.
  if (nextUrl.pathname.startsWith("/api/shared/")) {
    return NextResponse.next();
  }

  // Electron IPC API endpoints — localhost only, no auth required.
  if (nextUrl.pathname.startsWith("/api/electron/")) {
    return NextResponse.next();
  }

  // Other API routes — return JSON errors instead of redirecting.
  if (nextUrl.pathname.startsWith("/api/")) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (nextUrl.pathname.startsWith("/api/admin") && session?.user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Unauthenticated page requests → /login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // /admin/* pages require role='admin'; non-admins land on /library
  if (nextUrl.pathname.startsWith("/admin") && session?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/library", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Pages (excluding static assets)
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)",
    // API routes (including extensions like /book.epub)
    "/api/:path*",
  ],
};
