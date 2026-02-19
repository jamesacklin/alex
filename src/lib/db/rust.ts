import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type SqlParam = string | number | boolean | null;
export type SqlRow = Record<string, unknown>;

type DbMode = "query-all" | "query-one" | "execute";

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

async function callRustDb<T>(mode: DbMode, request: SqlRequest): Promise<T> {
  const binaryPath = await resolveBinaryPath();

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ["db", mode], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `[rust-db] watcher-rs exited with code ${code}\n${stderr.trim() || "(no stderr)"}`
          )
        );
        return;
      }

      const payload = stdout.trim();
      if (!payload) {
        reject(new Error("[rust-db] watcher-rs returned empty output"));
        return;
      }

      try {
        resolve(JSON.parse(payload) as T);
      } catch (error) {
        reject(
          new Error(
            `[rust-db] Failed to parse watcher-rs JSON output: ${(error as Error).message}\nOutput: ${payload}`
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

export async function queryAll<T extends SqlRow = SqlRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const result = await callRustDb<QueryAllResponse>("query-all", { sql, params });
  return result.rows as T[];
}

export async function queryOne<T extends SqlRow = SqlRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T | null> {
  const result = await callRustDb<QueryOneResponse>("query-one", { sql, params });
  return result.row as T | null;
}

export async function execute(sql: string, params: SqlParam[] = []): Promise<number> {
  const result = await callRustDb<ExecuteResponse>("execute", { sql, params });
  return result.changes;
}
