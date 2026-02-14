import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";

let dbInstance: BetterSQLite3Database | null = null;

function initDb(): BetterSQLite3Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH ?? "./data/library.db";
  const absolutePath = path.resolve(dbPath);

  // Ensure the directory exists
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const client = new Database(absolutePath);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");

  dbInstance = drizzle(client);
  return dbInstance;
}

export const db = new Proxy({} as BetterSQLite3Database, {
  get(target, prop) {
    const instance = initDb();
    const value = instance[prop as keyof BetterSQLite3Database];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});
