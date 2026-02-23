/**
 * @jest-environment node
 */
import {
  HttpRequestError,
  fetchJsonOrThrow,
  getRequestErrorPresentation,
  isAbortError,
} from "@/lib/client/request-error";

describe("request-error helpers", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("maps 403 errors to forbidden presentation", () => {
    const error = new HttpRequestError("Forbidden", {
      status: 403,
      url: "http://localhost/api/books",
    });

    const presentation = getRequestErrorPresentation(error, {
      resourceLabel: "book file",
    });

    expect(presentation.kind).toBe("forbidden");
    expect(presentation.title).toBe("Forbidden");
    expect(presentation.description).toBe(
      "You do not have permission to access this book file.",
    );
  });

  it("maps 404 errors to not-found presentation", () => {
    const error = new HttpRequestError("Not found", {
      status: 404,
      url: "http://localhost/api/books/1/file",
    });

    const presentation = getRequestErrorPresentation(error, {
      resourceLabel: "book file",
    });

    expect(presentation.kind).toBe("not-found");
    expect(presentation.title).toBe("Not found");
    expect(presentation.description).toBe(
      "The requested book file could not be found.",
    );
  });

  it("maps 500 errors to server presentation", () => {
    const error = new HttpRequestError("Internal error", {
      status: 500,
      url: "http://localhost/api/books",
    });

    const presentation = getRequestErrorPresentation(error);

    expect(presentation.kind).toBe("server");
    expect(presentation.title).toBe("Server error");
  });

  it("detects CORS issues from error text", () => {
    const presentation = getRequestErrorPresentation(
      new Error("Failed to fetch: blocked by CORS policy"),
      { providerLabel: "S3" },
    );

    expect(presentation.kind).toBe("cors");
    expect(presentation.title).toBe("S3 CORS error");
  });

  it("detects S3 connection issues from error text", () => {
    const presentation = getRequestErrorPresentation(
      new Error("Failed to list S3 objects: connection refused"),
      { providerLabel: "S3" },
    );

    expect(presentation.kind).toBe("s3-connection");
    expect(presentation.title).toBe("Unable to connect to S3");
  });

  it("detects generic connection issues when provider is not S3 specific", () => {
    const presentation = getRequestErrorPresentation(
      new Error("NetworkError when attempting to fetch resource"),
      { providerLabel: "API" },
    );

    expect(presentation.kind).toBe("connection");
    expect(presentation.title).toBe("Connection error (API)");
  });

  it("returns generic presentation with action label", () => {
    const presentation = getRequestErrorPresentation(new Error("unknown"), {
      actionLabel: "load books",
    });

    expect(presentation.kind).toBe("generic");
    expect(presentation.title).toBe("Failed to load books");
  });

  it("fetchJsonOrThrow returns parsed JSON for successful responses", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    await expect(fetchJsonOrThrow<{ ok: boolean }>("/api/test")).resolves.toEqual({
      ok: true,
    });
  });

  it("fetchJsonOrThrow throws HttpRequestError with parsed JSON details", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Forbidden", details: "Denied by policy" }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as typeof fetch;

    await expect(fetchJsonOrThrow("/api/test")).rejects.toMatchObject({
      name: "HttpRequestError",
      status: 403,
      error: "Forbidden",
      details: "Denied by policy",
    });
  });

  it("fetchJsonOrThrow throws HttpRequestError with text body fallback", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response("gateway unavailable", {
        status: 502,
        headers: { "content-type": "text/plain" },
      }),
    ) as typeof fetch;

    await expect(fetchJsonOrThrow("/api/test")).rejects.toMatchObject({
      name: "HttpRequestError",
      status: 502,
      rawBody: "gateway unavailable",
    });
  });

  it("identifies abort errors", () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    expect(isAbortError(abortError)).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
