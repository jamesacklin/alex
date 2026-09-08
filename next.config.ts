import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * A book is untrusted content the owner opens deliberately, and it renders
 * in an iframe inside this origin. The reader disables EPUB-authored
 * scripting (see `allowScriptedContent` in EpubReader), which is what
 * actually stops a hostile book executing; these directives narrow what
 * anything running on the page could reach if it did.
 *
 * `script-src 'unsafe-eval'` is development-only: the Next.js dev server
 * needs it, production builds do not, and pdf.js probes for eval support at
 * runtime and falls back when it is unavailable.
 *
 * `'unsafe-inline'` in `script-src` remains: Next.js emits inline bootstrap
 * and flight-data scripts, and removing it requires migrating to per-request
 * nonces. That migration is tracked as a follow-up rather than done here —
 * see docs/release/adversarial-review-remediation.md.
 */
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(isProduction ? [] : ["'unsafe-eval'"]),
].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: ws: wss:",
  // Book content is rendered from srcdoc/blob documents on this origin.
  "frame-src 'self' blob: data:",
  // pdf.js runs its parser in a blob-backed worker.
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  // No plugins, and no <base> rewriting of relative URLs from book markup.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Keep any window this page opens out of the opener's browsing context
  // group, so book content cannot reach back through window.opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

if (isProduction) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@alex/ui"],
  env: {
    NEXT_PUBLIC_ALEX_DESKTOP: process.env.ALEX_DESKTOP,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
