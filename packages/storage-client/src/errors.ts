// AUTHORED-BY Claude Opus 5.5
import type { Features } from "@jeswr/storage-capabilities";

/** ADR-003 §2. */
export type StorageErrorCode =
  | "unauthenticated" // 401 (pod-auth already retried; surfacing means login is required)
  | "forbidden" // 403
  | "not-found" // 404, 410
  | "conflict" // 409 (non-empty container delete, move cycle, name clash)
  | "precondition-failed" // 412
  | "precondition-required" // 428
  | "unsupported-media-type" // 415
  | "method-not-allowed" // 405
  | "payload-too-large" // 413
  | "insufficient-storage" // 507
  | "rate-limited" // 429 (retryAfterMs from Retry-After)
  | "bad-request" // 400, 422 and other 4xx
  | "server" // 5xx other
  | "network" // fetch threw / aborted
  | "invalid-response" // body or headers violate the protocol
  | "not-rdf" // readRdf on a non-RDF body
  | "unsupported" // operation not available on this storage; see `feature`
  | "scope"; // URL outside the storage root

/** RFC 9457 problem details (only string members are trusted for display). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  detail?: string;
  instance?: string;
  [member: string]: unknown;
}

export interface StorageErrorInit {
  status?: number | null;
  url: string;
  method: string;
  etag?: string | null;
  problem?: ProblemDetails | null;
  retryable?: boolean;
  retryAfterMs?: number | null;
  feature?: keyof Features;
  cause?: unknown;
  message?: string;
}

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly status: number | null;
  readonly url: string;
  readonly method: string;
  /** Current ETag when the server sent one on 412. */
  readonly etag: string | null;
  readonly problem: ProblemDetails | null;
  /** True for network, 429, 502/503/504. */
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  /** For 'unsupported'. */
  readonly feature?: keyof Features;

  constructor(code: StorageErrorCode, init: StorageErrorInit) {
    super(
      init.message ??
        `${init.method} ${init.url} failed: ${code}${init.status ? ` (${init.status})` : ""}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = "StorageError";
    this.code = code;
    this.status = init.status ?? null;
    this.url = init.url;
    this.method = init.method;
    this.etag = init.etag ?? null;
    this.problem = init.problem ?? null;
    this.retryable = init.retryable ?? (code === "network" || code === "rate-limited");
    this.retryAfterMs = init.retryAfterMs ?? null;
    if (init.feature !== undefined) this.feature = init.feature;
  }
}

const STATUS_CODES: Readonly<Record<number, StorageErrorCode>> = {
  400: "bad-request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  405: "method-not-allowed",
  409: "conflict",
  410: "not-found",
  412: "precondition-failed",
  413: "payload-too-large",
  415: "unsupported-media-type",
  422: "bad-request",
  428: "precondition-required",
  429: "rate-limited",
  507: "insufficient-storage",
};

/** Problem bodies larger than this are not parsed. */
export const MAX_PROBLEM_BYTES = 65_536;

function problemFrom(contentType: string | null, bodyText: string | undefined) {
  if (bodyText === undefined || new TextEncoder().encode(bodyText).byteLength > MAX_PROBLEM_BYTES) {
    return null;
  }
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/problem+json" && mediaType !== "application/json") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const problem: ProblemDetails = { ...(parsed as Record<string, unknown>) };
  for (const member of ["type", "title", "detail", "instance"] as const) {
    if (member in problem && typeof problem[member] !== "string") delete problem[member];
  }
  // Plain JSON bodies count only when they look like a problem (title/detail present).
  if (
    mediaType === "application/json" &&
    problem.title === undefined &&
    problem.detail === undefined
  ) {
    return null;
  }
  return problem;
}

/** Retry-After as delay-seconds or an HTTP-date, relative to `now`. Negative or invalid → null. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  // An HTTP-date always names the day/month; bare signed numbers are not dates.
  if (!/[a-z]/i.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/**
 * Pure mapping of a non-success HTTP response to a StorageError (ADR-003 §2). `bodyText` is the
 * already read (bounded) body; RFC 9457 `application/problem+json` and problem-shaped
 * `application/json` bodies up to 64 KiB are parsed, anything else (Turtle, HTML) is discarded.
 */
export function toStorageError(
  method: string,
  url: string,
  response: Pick<Response, "status" | "headers">,
  bodyText?: string,
  now: number = Date.now(),
): StorageError {
  const status = response.status;
  const code: StorageErrorCode =
    STATUS_CODES[status] ??
    (status >= 500 && status <= 599
      ? "server"
      : status >= 400 && status <= 499
        ? "bad-request"
        : "invalid-response");
  const retryAfterMs =
    code === "rate-limited" || status === 503
      ? parseRetryAfter(response.headers.get("retry-after"), now)
      : null;
  return new StorageError(code, {
    status,
    url,
    method,
    etag: status === 412 ? response.headers.get("etag") : null,
    problem: problemFrom(response.headers.get("content-type"), bodyText),
    retryable: code === "rate-limited" || status === 502 || status === 503 || status === 504,
    retryAfterMs,
  });
}

/** Read at most MAX_PROBLEM_BYTES of an error body, only for JSON media types. */
export async function readErrorBody(response: Response): Promise<string | undefined> {
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/problem+json" && mediaType !== "application/json") {
    // Never await a cancel: on a tee'd (cloned) body it settles only once the sibling is consumed.
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROBLEM_BYTES) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Read the (bounded) body and map the response. */
export async function storageErrorFrom(
  method: string,
  url: string,
  response: Response,
  now: number = Date.now(),
): Promise<StorageError> {
  return toStorageError(method, url, response, await readErrorBody(response), now);
}
