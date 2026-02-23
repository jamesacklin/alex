type JsonRecord = Record<string, unknown>;

export interface RequestErrorContext {
  resourceLabel?: string;
  actionLabel?: string;
  providerLabel?: string;
}

export type RequestErrorKind =
  | "not-found"
  | "forbidden"
  | "server"
  | "cors"
  | "s3-connection"
  | "connection"
  | "generic";

export interface RequestErrorPresentation {
  kind: RequestErrorKind;
  title: string;
  description?: string;
  inlineMessage: string;
}

interface ParsedErrorPayload {
  error?: string;
  details?: string;
  message?: string;
  rawBody?: string;
}

export class HttpRequestError extends Error {
  readonly status: number;
  readonly url: string;
  readonly error?: string;
  readonly details?: string;
  readonly rawBody?: string;

  constructor(
    message: string,
    options: {
      status: number;
      url: string;
      error?: string;
      details?: string;
      rawBody?: string;
    },
  ) {
    super(message);
    this.name = "HttpRequestError";
    this.status = options.status;
    this.url = options.url;
    this.error = options.error;
    this.details = options.details;
    this.rawBody = options.rawBody;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function extractStatus(error: unknown): number | undefined {
  if (error instanceof HttpRequestError) return error.status;
  if (!isRecord(error)) return undefined;

  const status = error.status;
  if (typeof status === "number" && Number.isFinite(status)) return status;

  if (isRecord(error.response)) {
    const responseStatus = error.response.status;
    if (
      typeof responseStatus === "number" &&
      Number.isFinite(responseStatus)
    ) {
      return responseStatus;
    }
  }

  return undefined;
}

function extractErrorText(error: unknown): string {
  if (error instanceof HttpRequestError) {
    return [error.message, error.error, error.details, error.rawBody]
      .filter(Boolean)
      .join(" ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error)) {
    const message = getString(error.message);
    const detail = getString(error.details);
    const serverError = getString(error.error);
    return [message, serverError, detail].filter(Boolean).join(" ");
  }

  return "";
}

function isCorsIssue(text: string) {
  return (
    text.includes("cors") ||
    text.includes("cross-origin") ||
    text.includes("cross origin") ||
    text.includes("preflight") ||
    (text.includes("blocked by") && text.includes("origin"))
  );
}

function isConnectionIssue(text: string) {
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("load failed") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("ehostunreach") ||
    text.includes("socket hang up") ||
    text.includes("connection reset") ||
    text.includes("connection refused") ||
    text.includes("timed out") ||
    text.includes("timeout")
  );
}

function isS3ConnectionIssue(text: string) {
  const mentionsProvider =
    text.includes("s3") ||
    text.includes("r2") ||
    text.includes("cloudflarestorage") ||
    text.includes("bucket") ||
    text.includes("object storage");

  const mentionsConnectionFailure =
    isConnectionIssue(text) ||
    text.includes("failed to list s3 objects") ||
    text.includes("s3 stream failed") ||
    text.includes("s3 stream timeout") ||
    text.includes("failed to spawn s3 stream") ||
    text.includes("no such bucket");

  return mentionsProvider && mentionsConnectionFailure;
}

function describeResource(resourceLabel?: string) {
  return resourceLabel?.trim() || "resource";
}

function buildGenericFailureTitle(actionLabel?: string) {
  if (!actionLabel) return "Request failed";
  return `Failed to ${actionLabel}`;
}

export function getRequestErrorPresentation(
  error: unknown,
  context: RequestErrorContext = {},
): RequestErrorPresentation {
  const status = extractStatus(error);
  const rawText = extractErrorText(error).toLowerCase();
  const resource = describeResource(context.resourceLabel);
  const provider = context.providerLabel?.trim();
  const providerName = provider || "S3 provider";

  if (isCorsIssue(rawText)) {
    return {
      kind: "cors",
      title: `${provider || "Storage"} CORS error`,
      description:
        "The browser blocked this request. Update bucket CORS to allow this app origin.",
      inlineMessage:
        "CORS blocked access to this file. Update bucket CORS settings and retry.",
    };
  }

  if (isS3ConnectionIssue(rawText)) {
    return {
      kind: "s3-connection",
      title: `Unable to connect to ${providerName}`,
      description:
        "Check endpoint, bucket name, credentials, and network connectivity.",
      inlineMessage:
        "Could not reach the S3 provider. Verify endpoint and credentials.",
    };
  }

  if (status === 403 || rawText.includes("forbidden") || rawText.includes("access denied")) {
    return {
      kind: "forbidden",
      title: "Forbidden",
      description: `You do not have permission to access this ${resource}.`,
      inlineMessage: "Access denied for this file.",
    };
  }

  if (status === 404 || rawText.includes("not found") || rawText.includes("no such key")) {
    return {
      kind: "not-found",
      title: "Not found",
      description: `The requested ${resource} could not be found.`,
      inlineMessage: "This file could not be found.",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: "server",
      title: "Server error",
      description: "The server returned an unexpected error. Please try again.",
      inlineMessage: "Server error while loading this file.",
    };
  }

  if (isConnectionIssue(rawText)) {
    return {
      kind: "connection",
      title: provider ? `Connection error (${provider})` : "Connection error",
      description: "Check your network connection and try again.",
      inlineMessage: "Connection error while loading this file.",
    };
  }

  return {
    kind: "generic",
    title: buildGenericFailureTitle(context.actionLabel),
    description: getString(extractErrorText(error)) || undefined,
    inlineMessage: "Failed to load this file. Please try again.",
  };
}

export async function fetchJsonOrThrow<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw await buildHttpRequestError(response);
  }

  return (await response.json()) as T;
}

async function buildHttpRequestError(response: Response): Promise<HttpRequestError> {
  const payload = await parseErrorPayload(response);
  const message =
    payload.error ||
    payload.message ||
    payload.rawBody ||
    `Request failed with status ${response.status}`;

  return new HttpRequestError(message, {
    status: response.status,
    url: response.url,
    error: payload.error,
    details: payload.details,
    rawBody: payload.rawBody,
  });
}

async function parseErrorPayload(response: Response): Promise<ParsedErrorPayload> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await response.json()) as unknown;
      if (isRecord(json)) {
        return {
          error: getString(json.error),
          details: getString(json.details),
          message: getString(json.message),
        };
      }
    } catch {
      return {};
    }
    return {};
  }

  try {
    const text = await response.text();
    return { rawBody: getString(text) };
  } catch {
    return {};
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}
