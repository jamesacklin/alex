import chokidar from "chokidar";
import path from "path";
import fs from "fs";
import { log } from "./log";
import { handleAdd } from "./handleAdd";
import { handleDelete } from "./handleDelete";
import { handleChange } from "./handleChange";

const libraryPath = process.env.LIBRARY_PATH ?? "./data/library";
const resolvedPath = path.resolve(libraryPath);

fs.mkdirSync(resolvedPath, { recursive: true });

function isTarget(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".epub");
}

// chokidar v4+ has no glob support — filter via ignored.
// Directories are never ignored so traversal continues; non-.pdf/.epub files are skipped.
const watcher = chokidar.watch(resolvedPath, {
  ignored: (filePath, stats) => !!stats?.isFile() && !isTarget(filePath),
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: { stabilityThreshold: 2000 },
});

log(`Watching ${resolvedPath} for .pdf and .epub files…`);

watcher
  .on("add", (filePath) => {
    handleAdd(filePath);
  })
  .on("change", (filePath) => {
    handleChange(filePath);
  })
  .on("unlink", (filePath) => {
    handleDelete(filePath);
  })
  .on("error", (error) => {
    log(`[ERROR] ${error}`);
  });

function shutdown() {
  log("Shutting down…");
  watcher.close().then(() => {
    log("Watcher closed.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
