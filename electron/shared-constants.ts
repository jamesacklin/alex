/**
 * Constants shared with the Next.js application.
 *
 * The Electron main process compiles with its own tsconfig (`rootDir: "."`),
 * so it cannot import from `src/`. These values are therefore declared twice,
 * and `src/__tests__/desktop-constants.test.ts` fails if the two copies ever
 * drift apart.
 *
 * Canonical definitions:
 *   - DESKTOP_PRINCIPAL_*    src/lib/auth/principals.ts
 *   - NON_LOGIN_PASSWORD_HASH src/lib/auth/password.ts
 */

export const DESKTOP_PRINCIPAL_ID = '1';
export const DESKTOP_PRINCIPAL_EMAIL = 'admin@localhost';
export const DESKTOP_PRINCIPAL_DISPLAY_NAME = 'Admin';

/**
 * Password-hash sentinel for accounts that must never authenticate.
 * Deliberately not a bcrypt digest.
 */
export const NON_LOGIN_PASSWORD_HASH = '!';
