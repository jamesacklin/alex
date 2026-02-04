import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_PATH ?? "./data/library.db";
const absolutePath = path.resolve(dbPath);

// Ensure the directory exists
fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const client = new Database(absolutePath);
client.pragma("journal_mode = WAL");
client.pragma("foreign_keys = ON");

export const db = drizzle(client);
