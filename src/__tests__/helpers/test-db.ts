import fs from "fs";
import os from "os";
import path from "path";

/**
 * Point a test suite at a disposable SQLite database built by the real
 * migration runner.
 *
 * Tests used to hand-roll `CREATE TABLE` statements, which meant they ran
 * against a schema that could drift from the one the app actually ships —
 * a missing unique index or column would not be noticed until production.
 * Going through `watcher-rs db migrate` keeps the fixtures honest.
 *
 * Call this at module scope, before importing anything that touches the DB,
 * because `DATABASE_PATH` is read when the bridge spawns a child process.
 */
export function createTestDatabase(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `alex-${name}-`));
  const file = path.join(dir, `${name}.db`);
  process.env.DATABASE_PATH = file;

  return {
    dir,
    file,
    /** Apply the shipped migration series. Safe to call more than once. */
    async migrate() {
      const { migrate } = await import("@/lib/db/rust");
      await migrate();
    },
    /** Delete every row, leaving the schema in place. */
    async truncate() {
      const { transaction } = await import("@/lib/db/rust");
      await transaction([
        { sql: "DELETE FROM collection_books" },
        { sql: "DELETE FROM collections" },
        { sql: "DELETE FROM reading_progress" },
        { sql: "DELETE FROM books" },
        { sql: "DELETE FROM users" },
        { sql: "DELETE FROM settings" },
      ]);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
