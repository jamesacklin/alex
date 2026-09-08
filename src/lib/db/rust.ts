import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type SqlParam = string | number | boolean | null;
export type SqlRow = Record<string, unknown>;

type DbMode = "query-all" | "query-one" | "execute" | "transaction" | "migrate";

/** Statement modes accepted inside a transaction batch. */
export type TransactionStatementMode = "execute" | "query-one" | "query-all";

export interface TransactionStatement {
  sql: string;
  params?: SqlParam[];
  mode?: TransactionStatementMode;
}

export type TransactionResult =
  | { changes: number }
  | { row: SqlRow | null }
  | { rows: SqlRow[] };

interface SqlRequest {
  sql: string;
  params: SqlParam[];
}

interface QueryAllResponse {
  rows: SqlRow[];
}

interface QueryOneResponse {
  row: SqlRow | null;
}

interface ExecuteResponse {
  changes: number;
}

interface TransactionResponse {
  results: TransactionResult[];
}

export interface MigrateResponse {
  applied: { version: number; name: string }[];
  version: number | null;
}

/**
 * Guard rails on the process-per-query bridge.
 *
 * Every call spawns a `watcher-rs db` child, so an unbounded number of
 * concurrent requests would fork an unbounded number of processes, and a
 * hung or runaway child would occupy a request slot forever.  Cap all three
 * dimensions: how many children run at once, how long one may run, and how
 * much output it may produce before we give up on it.
 */
const MAX_CONCURRENT_DB_PROCESSES = numberFromEnv("ALEX_DB_MAX_CONCURRENCY", 16, 1, 256);
const DB_PROCESS_TIMEOUT_MS = numberFromEnv("ALEX_DB_TIMEOUT_MS", 30_000, 1_000, 600_000);
const MAX_DB_OUTPUT_BYTES = numberFromEnv(
  "ALEX_DB_MAX_OUTPUT_BYTES",
  64 * 1024 * 1024,
  64 * 1024,
  512 * 1024 * 1024
);
const MAX_DB_STDERR_BYTES = 64 * 1024;

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

let activeDbProcesses = 0;
const dbQueue: (() => void)[] = [];

function acquireDbSlot(): Promise<void> {
  if (activeDbProcesses < MAX_CONCURRENT_DB_PROCESSES) {
    activeDbProcesses += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    dbQueue.push(() => {
      activeDbProcesses += 1;
      resolve();
    });
  });
}

function releaseDbSlot(): void {
  activeDbProcesses -= 1;
  const next = dbQueue.shift();
  if (next) next();
}

let binaryPathPromise: Promise<string> | null = null;

function watcherBinaryName() {
  return process.platform === "win32" ? "watcher-rs.exe" : "watcher-rs";
}

async function resolveBinaryPath(): Promise<string> {
  if (binaryPathPromise) {
    return binaryPathPromise;
  }

  binaryPathPromise = (async () => {
    const projectRoot = process.cwd();
    const binaryName = watcherBinaryName();
    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string };
    const resourcesPath = processWithResourcesPath.resourcesPath;

    const packagedBinary = path.join(projectRoot, "watcher-rs", binaryName);
    const debugBinary = path.join(projectRoot, "watcher-rs", "target", "debug", binaryName);
    const releaseBinary = path.join(projectRoot, "watcher-rs", "target", "release", binaryName);
    const distBinary = path.join(projectRoot, "watcher-rs", "dist", binaryName);
    const resourcesBinary = resourcesPath
      ? path.join(resourcesPath, "watcher-rs", binaryName)
      : undefined;
    const envBinary = process.env.WATCHER_RS_BIN;

    const candidates = [envBinary, releaseBinary, debugBinary, distBinary, packagedBinary, resourcesBinary].filter(
      (value): value is string => Boolean(value)
    );

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `[rust-db] Could not find watcher-rs binary. Checked: ${candidates.join(", ")}. Build it with 'pnpm watcher:build'.`
    );
  })();

  return binaryPathPromise;
}

async function callRustDb<T>(mode: DbMode, request: unknown): Promise<T> {
  const binaryPath = await resolveBinaryPath();
  await acquireDbSlot();

  try {
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(binaryPath, ["db", mode], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stdoutBytes = 0;
      let stderr = "";
      let settled = false;

      const finish = (error: Error | null, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value as T);
      };

      const abort = (error: Error) => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        finish(error);
      };

      const timer = setTimeout(() => {
        abort(
          new Error(
            `[rust-db] watcher-rs db ${mode} exceeded ${DB_PROCESS_TIMEOUT_MS}ms and was terminated`
          )
        );
      }, DB_PROCESS_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk, "utf8");
        if (stdoutBytes > MAX_DB_OUTPUT_BYTES) {
          abort(
            new Error(
              `[rust-db] watcher-rs db ${mode} produced more than ${MAX_DB_OUTPUT_BYTES} bytes; refusing to buffer it`
            )
          );
          return;
        }
        stdout += chunk;
      });

      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_DB_STDERR_BYTES) {
          stderr += chunk;
        }
      });

      child.on("error", (error) => {
        finish(error);
      });

      child.on("close", (code) => {
        if (settled) return;

        if (code !== 0) {
          finish(
            new Error(
              `[rust-db] watcher-rs exited with code ${code}\n${stderr.trim() || "(no stderr)"}`
            )
          );
          return;
        }

        const payload = stdout.trim();
        if (!payload) {
          finish(new Error("[rust-db] watcher-rs returned empty output"));
          return;
        }

        try {
          finish(null, JSON.parse(payload) as T);
        } catch (error) {
          finish(
            new Error(
              `[rust-db] Failed to parse watcher-rs JSON output: ${(error as Error).message}\nOutput: ${payload}`
            )
          );
        }
      });

      child.stdin.on("error", () => {
        // The child may exit before we finish writing; `close` reports it.
      });

      if (request !== undefined) {
        child.stdin.write(JSON.stringify(request));
      }
      child.stdin.end();
    });
  } finally {
    releaseDbSlot();
  }
}

export async function queryAll<T extends SqlRow = SqlRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const result = await callRustDb<QueryAllResponse>("query-all", { sql, params } satisfies SqlRequest);
  return result.rows as T[];
}

export async function queryOne<T extends SqlRow = SqlRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T | null> {
  const result = await callRustDb<QueryOneResponse>("query-one", { sql, params } satisfies SqlRequest);
  return result.row as T | null;
}

export async function execute(sql: string, params: SqlParam[] = []): Promise<number> {
  const result = await callRustDb<ExecuteResponse>("execute", { sql, params } satisfies SqlRequest);
  return result.changes;
}

/**
 * Run several statements on one connection inside one SQLite transaction.
 *
 * Any error rolls the whole batch back, so callers never leave partial
 * state behind.  Note that sending `BEGIN` / `COMMIT` through separate
 * `execute()` calls is *not* a transaction: each call is its own process
 * and its own connection.
 */
export async function transaction(
  statements: TransactionStatement[]
): Promise<TransactionResult[]> {
  if (statements.length === 0) return [];

  const result = await callRustDb<TransactionResponse>("transaction", {
    statements: statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params ?? [],
      mode: statement.mode ?? "execute",
    })),
  });
  return result.results;
}

/**
 * Apply every pending schema migration. Idempotent, and safe to call on a
 * database that is already current.
 */
export async function migrate(): Promise<MigrateResponse> {
  return callRustDb<MigrateResponse>("migrate", undefined);
}

/** Number of rows a transaction statement changed, for `changes` results. */
export function changesOf(result: TransactionResult | undefined): number {
  if (result && "changes" in result) return result.changes;
  return 0;
}

/** Row a transaction statement returned, for `query-one` results. */
export function rowOf<T extends SqlRow = SqlRow>(
  result: TransactionResult | undefined
): T | null {
  if (result && "row" in result) return result.row as T | null;
  return null;
}
