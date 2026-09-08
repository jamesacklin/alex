/**
 * Password-hash helpers shared by the auth config, the setup flow and the
 * desktop bootstrap.
 *
 * Some accounts exist purely so that foreign keys resolve — the synthetic
 * desktop principal, for instance, has to be a real `users` row because
 * reading progress and collections reference it, but it must never be able
 * to log in over the network.  Those rows carry a sentinel hash that is not
 * a bcrypt digest, and `isLoginCapablePasswordHash` is the single gate that
 * decides whether a stored hash may be presented to `bcrypt.compare` at all.
 */

/**
 * Stored in `users.password_hash` for accounts that must not authenticate.
 * Deliberately not a bcrypt digest.
 */
export const NON_LOGIN_PASSWORD_HASH = "!";

const BCRYPT_HASH = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * True only for a well-formed bcrypt digest.
 *
 * Anything else — the sentinel above, an empty string, a truncated or
 * corrupted value — is treated as "this account cannot log in" rather than
 * being handed to `bcrypt.compare`, whose behaviour on malformed input is
 * not a security boundary we want to depend on.
 */
export function isLoginCapablePasswordHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && BCRYPT_HASH.test(hash);
}

/** Minimum length enforced everywhere a password is set or changed. */
export const MIN_PASSWORD_LENGTH = 8;
