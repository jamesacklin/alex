/**
 * First-run bootstrap credential (F01, F06).
 *
 * `/setup` used to be open to whoever reached the server first: on a fresh
 * install any visitor could claim the administrator account.  Initial setup
 * now requires a one-time token that only someone with access to the host
 * can read — from the server log, or from the file written next to the
 * database.
 *
 * The token is consumed once setup succeeds, so `/setup` cannot be replayed.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { queryOne } from "@/lib/db/rust";

const SETUP_TOKEN_FILENAME = "setup-token";

function databaseDirectory(): string {
  const databasePath = process.env.DATABASE_PATH || "./data/library.db";
  return path.dirname(path.resolve(databasePath));
}

/** Absolute path of the file that holds the one-time setup token. */
export function setupTokenPath(): string {
  return path.join(databaseDirectory(), SETUP_TOKEN_FILENAME);
}

/**
 * A token supplied by the deployment (Docker secret, orchestrator, CI).
 * When present it takes precedence and no file is written.
 */
function tokenFromEnvironment(): string | null {
  const token = process.env.ALEX_SETUP_TOKEN?.trim();
  return token ? token : null;
}

/** True when the database has at least one account. */
export async function anyUserExists(): Promise<boolean> {
  const row = await queryOne<{ id: string }>("SELECT id FROM users LIMIT 1");
  return row !== null;
}

/**
 * Return the current setup token, creating and logging one if this is a
 * fresh install that still needs setup.
 *
 * Returns `null` once setup has been completed.
 */
export async function ensureSetupToken(): Promise<string | null> {
  if (await anyUserExists()) {
    return null;
  }

  const fromEnv = tokenFromEnvironment();
  if (fromEnv) {
    return fromEnv;
  }

  const tokenPath = setupTokenPath();
  try {
    const existing = (await fs.readFile(tokenPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // No token file yet — fall through and create one.
  }

  const token = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });

  console.warn(
    [
      "",
      "============================================================",
      " Alex first-run setup",
      "",
      " Open /setup and enter this one-time token to create the",
      " administrator account:",
      "",
      `   ${token}`,
      "",
      ` It is also stored at ${tokenPath}`,
      " and is discarded as soon as setup completes.",
      "============================================================",
      "",
    ].join("\n")
  );

  return token;
}

/**
 * Read the setup token without creating one.
 *
 * Used by request handlers that must not have the side effect of minting a
 * token (for example a POST that is about to be rejected anyway).
 */
export async function readSetupToken(): Promise<string | null> {
  const fromEnv = tokenFromEnvironment();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const existing = (await fs.readFile(setupTokenPath(), "utf8")).trim();
    return existing || null;
  } catch {
    return null;
  }
}

/** Constant-time comparison of a presented token against the stored one. */
export async function verifySetupToken(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }

  const expected = await readSetupToken();
  if (!expected) {
    return false;
  }

  const presentedBytes = Buffer.from(candidate.trim(), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return crypto.timingSafeEqual(presentedBytes, expectedBytes);
}

/** Remove the one-time token so `/setup` cannot be replayed. */
export async function consumeSetupToken(): Promise<void> {
  try {
    await fs.rm(setupTokenPath(), { force: true });
  } catch (error) {
    console.error("[auth] Failed to remove the setup token file", error);
  }
}
