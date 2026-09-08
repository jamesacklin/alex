/**
 * Well-known account identities.
 *
 * Kept out of `config.ts` so that the Electron main process, the migration
 * tooling and tests can reference them without pulling in NextAuth.
 */

/**
 * The synthetic desktop principal.
 *
 * The row exists so that foreign keys from reading progress and collections
 * resolve. It is created with a non-login-capable password hash and cannot
 * authenticate through the credentials provider — the desktop app proves
 * itself with a per-launch capability header instead. Remote access to a
 * desktop install requires the owner to create a real account in
 * Admin → Users.
 */
export const DESKTOP_PRINCIPAL_ID = "1";
export const DESKTOP_PRINCIPAL_EMAIL = "admin@localhost";
export const DESKTOP_PRINCIPAL_DISPLAY_NAME = "Admin";
