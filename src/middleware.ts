import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/middleware-auth";
import { isDesktopMode, isDesktopRequestAuthorized } from "@/lib/auth/desktop-auth";

/** Build a base URL that respects X-Forwarded-Host/Proto from the relay. */
function originUrl(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto");
  if (fwdHost) {
    const proto = fwdProto || "https";
    return `${proto}://${fwdHost}`;
  }
  return req.url;
}

/**
 * True only for a session that names a concrete account.
 *
 * `req.auth` is not always a session: Auth.js can populate it with an object
 * describing a *configuration error* (GHSA-8fpg-xm3f-6cx3), and such an
 * object is truthy.  A `!!session` check therefore treats a misconfigured
 * deployment as authenticated.  Requiring a non-empty `user.id` fails closed
 * on the error object, on a partially decoded token, and on anything else
 * that is not a real identity.
 */
function hasConcreteIdentity(session: unknown): session is {
  user: { id: string; role?: unknown };
} {
  if (!session || typeof session !== "object") return false;
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== "object") return false;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}

export default auth((req) => {
  const { nextUrl } = req;
  const session: unknown = req.auth;
  const isApiRoute = nextUrl.pathname.startsWith("/api/");
  const isDesktop = isDesktopMode();
  const isDesktopAuthorized = isDesktop && isDesktopRequestAuthorized(req.headers);
  const base = originUrl(req);

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

  // Readiness probe — must answer before any account exists.
  if (nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  // Public shared collection API endpoints — no auth required.
  // Token validation happens within each endpoint.
  if (nextUrl.pathname.startsWith("/api/shared/")) {
    return NextResponse.next();
  }

  const identified = hasConcreteIdentity(session);
  const isAuthenticated = isDesktopAuthorized || identified;
  const isAdmin =
    isDesktopAuthorized || (identified && session.user.role === "admin");

  // Other API routes — return JSON errors instead of redirecting.
  if (isApiRoute) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (nextUrl.pathname.startsWith("/api/admin") && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Unauthenticated page requests → /login
  if (!isAuthenticated) {
    return NextResponse.redirect(new URL("/login", base));
  }

  // /admin/* pages require role='admin'; non-admins land on /library
  if (nextUrl.pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/library", base));
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
