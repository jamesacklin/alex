/**
 * Shared cookie configuration for NextAuth.
 *
 * Behind a reverse proxy or relay service the auto-detected cookie settings can
 * differ between the login handler (which sets cookies) and subsequent requests
 * (which read them).  For example the login response might use the `__Secure-`
 * prefix (because X-Forwarded-Proto says HTTPS) while a later API call sees
 * plain HTTP and looks for the unprefixed name — the cookie is never found and
 * every request returns 401.
 *
 * Pinning the names and flags here guarantees both NextAuth instances (the full
 * config used by route handlers and the lightweight one used by middleware) agree
 * on exactly which cookies to read and write.
 */

const useSecureCookies =
  process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

const prefix = useSecureCookies ? "__Secure-" : "";

export const authCookies = {
  sessionToken: {
    name: `${prefix}authjs.session-token`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: useSecureCookies,
    },
  },
  callbackUrl: {
    name: `${prefix}authjs.callback-url`,
    options: {
      sameSite: "lax" as const,
      path: "/",
      secure: useSecureCookies,
    },
  },
  csrfToken: {
    // __Host- prefix requires Secure + Path=/ + no Domain — only safe over
    // HTTPS.  Fall back to the plain name when NEXTAUTH_URL is HTTP.
    name: useSecureCookies
      ? "__Host-authjs.csrf-token"
      : "authjs.csrf-token",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: useSecureCookies,
    },
  },
};
