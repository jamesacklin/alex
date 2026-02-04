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

  // NextAuth internals — always pass through.
  if (nextUrl.pathname.startsWith("/api/auth")) {
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
    // Run on every path except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
