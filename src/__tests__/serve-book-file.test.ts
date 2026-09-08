/**
 * @jest-environment node
 *
 * Regressions for F07 (S3 downloads buffer entire files and can report
 * corruption as success).
 *
 * Note the reversed expectation in "streams an S3 range": the previous suite
 * asserted `Content-Range: bytes 10-14/5`, i.e. it locked in the bug where
 * the length of the returned slice was used as the total-object denominator.
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
  stdout: EventEmitter & { off: EventEmitter["off"] };
  stderr: EventEmitter;
  kill: jest.Mock<void, [signal?: string]>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter() as MockChildProcess["stdout"];
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

function header(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ protocol: 2, ...fields })}\n`;
}

function setS3Env() {
  process.env.S3_BUCKET = "books";
  process.env.S3_ACCESS_KEY_ID = "access";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
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

  describe("local disk", () => {
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
      expect(response.headers.get("content-length")).toBe("18");
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

    it("serves a closed range with the file size as the denominator", async () => {
      const localBook = path.join(tempDir, "range.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=2-5" },
        }),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(response.headers.get("content-length")).toBe("4");
      await expect(readAll(response)).resolves.toBe("2345");
    });

    it("clamps an end past the last byte instead of rejecting it", async () => {
      const localBook = path.join(tempDir, "clamp.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=8-9999" },
        }),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 8-9/10");
      await expect(readAll(response)).resolves.toBe("89");
    });

    it("serves an open-ended range", async () => {
      const localBook = path.join(tempDir, "open.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=7-" },
        }),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
      await expect(readAll(response)).resolves.toBe("789");
    });

    it("serves a suffix range from the end of the file", async () => {
      const localBook = path.join(tempDir, "suffix.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=-3" },
        }),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
      await expect(readAll(response)).resolves.toBe("789");
    });

    it("serves a single-byte range", async () => {
      const localBook = path.join(tempDir, "single.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=4-4" },
        }),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 4-4/10");
      await expect(readAll(response)).resolves.toBe("4");
    });

    it("returns 416 for a start past the end of the file", async () => {
      const localBook = path.join(tempDir, "past.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=50-60" },
        }),
      );

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    });

    it("returns 416 for any range against an empty file", async () => {
      const localBook = path.join(tempDir, "empty.pdf");
      fs.writeFileSync(localBook, "");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=0-" },
        }),
      );

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */0");
    });

    it("serves an empty file with no range as an empty 200", async () => {
      const localBook = path.join(tempDir, "empty200.pdf");
      fs.writeFileSync(localBook, "");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: localBook, fileType: "pdf" },
        new Request("http://localhost/api/books/1/file"),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("0");
      await expect(readAll(response)).resolves.toBe("");
    });

    it("ignores a malformed range header and serves the whole file", async () => {
      const localBook = path.join(tempDir, "malformed.pdf");
      fs.writeFileSync(localBook, "0123456789");

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      for (const range of ["bytes=abc", "bytes=1-2,4-5", "items=0-1", "bytes=-"]) {
        const response = await serveBookFile(
          { filePath: localBook, fileType: "pdf" },
          new Request("http://localhost/api/books/1/file", { headers: { range } }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-range")).toBeNull();
        await expect(readAll(response)).resolves.toBe("0123456789");
      }
    });
  });

  describe("S3", () => {
    it("streams S3 content and forwards the range argument", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(
              `${header({
                status: 206,
                content_type: "application/pdf",
                object_size: 1000,
                content_length: 5,
                range_start: 10,
                range_end: 14,
              })}hello`,
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
      // The denominator is the object size, not the length of the slice.
      expect(response.headers.get("content-range")).toBe("bytes 10-14/1000");
      expect(response.headers.get("content-length")).toBe("5");
      await expect(readAll(response)).resolves.toBe("hello");
    });

    it("responds as soon as the header arrives, before the body completes", async () => {
      setS3Env();
      let emitRest: (() => void) | null = null;

      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(header({ status: 200, object_size: 12, content_length: 12 })),
          );
        });
        emitRest = () => {
          child.stdout.emit("data", Buffer.from("hello world!"));
          child.emit("close", 0);
        };
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file"),
      );

      // The response object exists while the body is still in flight — the
      // whole point of streaming rather than buffering.
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("12");
      expect(emitRest).not.toBeNull();

      emitRest!();
      await expect(readAll(response)).resolves.toBe("hello world!");
    });

    it("errors the body when the transfer is truncated after the header", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(`${header({ status: 200, object_size: 1000, content_length: 1000 })}five!`),
          );
          child.stderr.emit("data", Buffer.from("connection reset"));
          child.emit("close", 1);
        });
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file"),
      );

      // Headers are already committed at this point, so the failure has to
      // surface as a broken body. It must never look like a complete file:
      // the old code answered 200 with Content-Length 5.
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("1000");
      await expect(readAll(response)).rejects.toThrow();
    });

    it("errors the body when the child exits cleanly but short", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(`${header({ status: 200, object_size: 20, content_length: 20 })}short`),
          );
          child.emit("close", 0);
        });
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file"),
      );

      await expect(readAll(response)).rejects.toThrow(/truncated/);
    });

    it("errors the body when the child sends more bytes than declared", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(`${header({ status: 200, object_size: 2, content_length: 2 })}far too much`),
          );
          child.emit("close", 0);
        });
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file"),
      );

      await expect(readAll(response)).rejects.toThrow();
    });

    it("passes a 416 from the helper through with the object size", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(header({ status: 416, object_size: 1000, content_length: 0 })),
          );
          child.emit("close", 0);
        });
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/book.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file", {
          headers: { range: "bytes=5000-6000" },
        }),
      );

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */1000");
    });

    it("maps a missing object to 404", async () => {
      setS3Env();
      spawnMock.mockImplementation(() => {
        const child = createMockChildProcess();
        setImmediate(() => {
          child.stdout.emit(
            "data",
            Buffer.from(header({ status: 404, error: "object not found", content_length: 0 })),
          );
          child.emit("close", 1);
        });
        return child as never;
      });

      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/gone.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file"),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "Book file not found in bucket",
      });
    });

    it("returns 500 when the S3 stream header cannot be parsed", async () => {
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

    it("returns 502 when the S3 stream exits before the header", async () => {
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

    it("returns 500 when spawning the S3 stream fails", async () => {
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

    it("returns 504 when the S3 stream times out before the header", async () => {
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

    it("kills the helper when the browser cancels the request", async () => {
      setS3Env();
      const child = createMockChildProcess();
      spawnMock.mockReturnValue(child as never);
      setImmediate(() => {
        child.stdout.emit(
          "data",
          Buffer.from(header({ status: 200, object_size: 1_000_000, content_length: 1_000_000 })),
        );
      });

      const controller = new AbortController();
      const { serveBookFile } = await import("@/lib/files/serve-book-file");
      const response = await serveBookFile(
        { filePath: "s3/big.pdf", fileType: "pdf", source: "s3" },
        new Request("http://localhost/api/books/1/file", { signal: controller.signal }),
      );

      expect(response.status).toBe(200);
      controller.abort();

      expect(child.kill).toHaveBeenCalled();
    });
  });
});
