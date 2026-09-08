/**
 * Explicit account provisioning.
 *
 * This script used to hash a published password (`admin123`) and
 * `ON CONFLICT ... DO UPDATE` it over whatever account already existed for
 * `admin@localhost`, which meant a container restart silently restored a
 * known administrator credential and undid the owner's password change.
 *
 * It now has no default credential at all, refuses to run without an
 * explicitly supplied email and password, and never modifies an account
 * that already exists.  Ordinary installs do not need it: the first-run
 * `/setup` flow creates the owner account.  It remains available for
 * automated environments (CI, test harnesses, orchestrated deployments)
 * that need to provision an account without a browser.
 */

import bcrypt from "bcryptjs";
import { execute } from "./rust";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

const USAGE = `
Provision an account explicitly:

  ALEX_ADMIN_EMAIL=owner@example.com \\
  ALEX_ADMIN_PASSWORD='<a password you choose>' \\
  pnpm db:seed

Optional:
  ALEX_ADMIN_DISPLAY_NAME   defaults to the local part of the email
  ALEX_ADMIN_ROLE           "admin" (default) or "user"
  ALEX_ADMIN_ID             fixed row id; defaults to a random UUID

This script never changes an account that already exists. To change a
password, use Admin -> Users in the app.
`;

function fail(message: string): never {
  console.error(`[db:seed] ${message}`);
  console.error(USAGE);
  process.exit(1);
}

async function seed() {
  const email = process.env.ALEX_ADMIN_EMAIL?.trim();
  const password = process.env.ALEX_ADMIN_PASSWORD;
  const role = process.env.ALEX_ADMIN_ROLE?.trim() || "admin";

  if (!email || !password) {
    fail("ALEX_ADMIN_EMAIL and ALEX_ADMIN_PASSWORD are both required.");
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    fail(`"${email}" is not a valid email address.`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ALEX_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (role !== "admin" && role !== "user") {
    fail(`ALEX_ADMIN_ROLE must be "admin" or "user".`);
  }

  const displayName =
    process.env.ALEX_ADMIN_DISPLAY_NAME?.trim() || email.split("@")[0] || email;
  const id = process.env.ALEX_ADMIN_ID?.trim() || crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = Math.floor(Date.now() / 1000);

  // Insert only. An existing row for this email is left exactly as it is —
  // restarting this script can never reset a credential the owner chose.
  const changes = await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role,
        session_version, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
      ON CONFLICT(email) DO NOTHING
    `,
    [id, email, passwordHash, displayName, role, now]
  );

  if (changes > 0) {
    console.log(`[db:seed] Created ${role} account ${email}.`);
  } else {
    console.log(
      `[db:seed] ${email} already exists; left unchanged. Use Admin -> Users to change its password.`
    );
  }
}

seed().catch((error) => {
  console.error("[db:seed] Failed:", error);
  process.exit(1);
});
