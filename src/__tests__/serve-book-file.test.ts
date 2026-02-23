/**
 * @jest-environment node
 */
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { spawn } from "child_process";

jest.mock("child_process", () => {
  const actual = jest.requireActual("child_process");
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock<void, []>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

function setS3Env() {
  process.env.S3_BUCKET = "books";
  process.env.S3_ACCESS_KEY_ID = "access";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
}

describe("serveBookFile", () => {
  const spawnMock = spawn as jest.MockedFunction<typeof spawn>;
  const originalEnv = { ...process.env };

  let tempDir: string;
  let watcherBin: string;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alex-serve-book-file-"));
    watcherBin = path.join(tempDir, "watcher-rs");
    fs.writeFileSync(watcherBin, "");
    process.env.WATCHER_RS_BIN = watcherBin;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 501 for unsupported sources", async () => {
    const { serveBookFile } = await import("@/lib/files/serve-book-file");

    const response = await serveBookFile(
      { filePath: "/tmp/book.pdf", fileType: "pdf", source: "gcs" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported book source: gcs",
    });
  });

  it("returns 500 when S3 bucket is missing", async () => {
    delete process.env.S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = "access";
    process.env.S3_SECRET_ACCESS_KEY = "secret";

    const { serveBookFile } = await import("@/lib/files/serve-book-file");

    const response = await serveBookFile(
      { filePath: "book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "S3 source is not configured on server",
      details: "Missing S3_BUCKET",
    });
  });

  it("returns 500 when S3 credentials are missing", async () => {
    process.env.S3_BUCKET = "books";
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    const { serveBookFile } = await import("@/lib/files/serve-book-file");

    const response = await serveBookFile(
      { filePath: "book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "S3 source credentials are missing on server",
      details: "Missing S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY",
    });
  });

  it("defaults missing source to local and streams file content", async () => {
    const localBook = path.join(tempDir, "local.pdf");
    fs.writeFileSync(localBook, "local-book-content");

    const { serveBookFile } = await import("@/lib/files/serve-book-file");

    const response = await serveBookFile(
      { filePath: localBook, fileType: "pdf" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("local-book-content");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("returns 404 for missing local files", async () => {
    const { serveBookFile } = await import("@/lib/files/serve-book-file");

    const response = await serveBookFile(
      { filePath: path.join(tempDir, "missing.pdf"), fileType: "pdf", source: "local" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "File not found on disk" });
  });

  it("streams S3 content and forwards range argument", async () => {
    setS3Env();
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      setImmediate(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            `${JSON.stringify({
              content_type: "application/pdf",
              content_length: 5,
              status: 206,
              range_start: 10,
              range_end: 14,
            })}\nhello`,
          ),
        );
        child.emit("close", 0);
      });
      return child as never;
    });

    const { serveBookFile } = await import("@/lib/files/serve-book-file");
    const response = await serveBookFile(
      { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file", {
        headers: { range: "bytes=10-14" },
      }),
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual(["s3-stream", "--key", "s3/book.pdf", "--range", "bytes=10-14"]);

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-14/5");
    await expect(response.text()).resolves.toBe("hello");
  });

  it("returns 500 when S3 stream header cannot be parsed", async () => {
    setS3Env();
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("not-json\nbody"));
        child.emit("close", 1);
      });
      return child as never;
    });

    const { serveBookFile } = await import("@/lib/files/serve-book-file");
    const response = await serveBookFile(
      { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to parse S3 stream header",
      details: "not-json",
    });
  });

  it("returns 502 when S3 stream exits before header", async () => {
    setS3Env();
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      setImmediate(() => {
        child.stderr.emit("data", Buffer.from("upstream failed"));
        child.emit("close", 2);
      });
      return child as never;
    });

    const { serveBookFile } = await import("@/lib/files/serve-book-file");
    const response = await serveBookFile(
      { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "S3 stream failed before response header",
      exitCode: 2,
      details: "upstream failed",
    });
  });

  it("returns 500 when spawning S3 stream fails", async () => {
    setS3Env();
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      setImmediate(() => {
        child.emit("error", new Error("spawn failed"));
      });
      return child as never;
    });

    const { serveBookFile } = await import("@/lib/files/serve-book-file");
    const response = await serveBookFile(
      { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to spawn S3 stream",
      details: "spawn failed",
    });
  });

  it("returns 504 when S3 stream times out before header", async () => {
    jest.useFakeTimers();
    setS3Env();

    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child as never);

    const { serveBookFile } = await import("@/lib/files/serve-book-file");
    const responsePromise = serveBookFile(
      { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
      new Request("http://localhost/api/books/1/file"),
    );

    jest.advanceTimersByTime(30_000);
    const response = await responsePromise;

    expect(child.kill).toHaveBeenCalled();
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ error: "S3 stream timeout" });
  });
});
