/**
 * Bounded login throttling.
 *
 * Credentials login is the only way in, so an unthrottled endpoint lets an
 * attacker grind passwords at whatever rate bcrypt allows.  Two constraints
 * shape the implementation:
 *
 *  - **Bounded memory.** An unbounded `Map` keyed by attacker-controlled
 *    input is itself a denial-of-service vector, so entries live in a
 *    fixed-capacity table with least-recently-used eviction.
 *
 *  - **Trusted attribution.** Client IPs reach this app through headers a
 *    remote caller can set (`x-forwarded-for` and friends), so keying on
 *    them would let an attacker reset their own budget at will and let a
 *    spoofed header lock out somebody else.  Throttling is therefore keyed
 *    on the submitted account, which an attacker targeting that account
 *    cannot vary, plus a process-wide budget that blunts spraying across
 *    many accounts.
 *
 * State is per-process and deliberately not persisted: a restart clears it,
 * which is the right trade for a single-process self-hosted app.
 */

const MAX_TRACKED_ACCOUNTS = 1024;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 30 * 1000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

/** Process-wide ceiling on failures, to blunt spraying across accounts. */
const GLOBAL_FAILURE_LIMIT = 100;
const GLOBAL_WINDOW_MS = 60 * 1000;

interface AccountState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

/**
 * Insertion-ordered map used as an LRU: re-inserting on access moves an
 * entry to the end, so the oldest key is always the first one `keys()`
 * yields.
 */
const accounts = new Map<string, AccountState>();

let globalFailures = 0;
let globalWindowStart = 0;

function touch(key: string, state: AccountState): void {
  accounts.delete(key);
  accounts.set(key, state);

  while (accounts.size > MAX_TRACKED_ACCOUNTS) {
    const oldest = accounts.keys().next();
    if (oldest.done) break;
    accounts.delete(oldest.value);
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lock out once `MAX_FAILURES_BEFORE_LOCKOUT` failures land inside the
 * window, then back off exponentially for each further failure.
 */
function lockoutFor(failures: number): number {
  const excess = failures - MAX_FAILURES_BEFORE_LOCKOUT;
  if (excess < 0) return 0;
  const backoff = BASE_LOCKOUT_MS * 2 ** Math.min(excess, 10);
  return Math.min(backoff, MAX_LOCKOUT_MS);
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Milliseconds until the caller may try again, when not allowed. */
  retryAfterMs: number;
  reason?: "account" | "global";
}

/** Check whether a login attempt for `email` may proceed. */
export function checkLoginAttempt(email: string, now = Date.now()): ThrottleDecision {
  if (globalWindowStart && now - globalWindowStart < GLOBAL_WINDOW_MS) {
    if (globalFailures >= GLOBAL_FAILURE_LIMIT) {
      return {
        allowed: false,
        retryAfterMs: GLOBAL_WINDOW_MS - (now - globalWindowStart),
        reason: "global",
      };
    }
  }

  const key = normalize(email);
  const state = accounts.get(key);
  if (!state) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (state.lockedUntil > now) {
    touch(key, state);
    return {
      allowed: false,
      retryAfterMs: state.lockedUntil - now,
      reason: "account",
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Record a failed attempt and return the resulting lockout, if any. */
export function recordLoginFailure(email: string, now = Date.now()): ThrottleDecision {
  if (!globalWindowStart || now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalWindowStart = now;
    globalFailures = 0;
  }
  globalFailures += 1;

  const key = normalize(email);
  const existing = accounts.get(key);
  const withinWindow = existing && now - existing.firstFailureAt < FAILURE_WINDOW_MS;

  const state: AccountState = withinWindow
    ? {
        failures: existing.failures + 1,
        firstFailureAt: existing.firstFailureAt,
        lockedUntil: 0,
      }
    : { failures: 1, firstFailureAt: now, lockedUntil: 0 };

  const lockout = lockoutFor(state.failures);
  state.lockedUntil = lockout > 0 ? now + lockout : 0;
  touch(key, state);

  return {
    allowed: lockout === 0,
    retryAfterMs: lockout,
    reason: lockout > 0 ? "account" : undefined,
  };
}

/** Clear an account's failure budget after a successful login. */
export function recordLoginSuccess(email: string): void {
  accounts.delete(normalize(email));
}

/** Test seam: drop all throttling state. */
export function resetLoginThrottle(): void {
  accounts.clear();
  globalFailures = 0;
  globalWindowStart = 0;
}

/** Test/diagnostic seam: number of accounts currently tracked. */
export function trackedAccountCount(): number {
  return accounts.size;
}
