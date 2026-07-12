// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The 4-class read-path error taxonomy every suite pod-app hand-rolls, named once
// here. A DataController read resolves OR throws exactly one of these four, so a
// consumer can branch on the CLASS (instanceof) rather than string-matching a
// status code or a message — the codegen-friendly contract.
//
//   - NotFoundError       (404 / 410)            — the resource does not exist.
//   - AccessDeniedError   (401 / 403)            — auth required or forbidden.
//   - NetworkError        (transport / abort / non-2xx that is not the above)
//   - DataFormatError     (a 2xx body that could not be parsed as the asked type)
//
// Every error carries the request URL + (where applicable) the HTTP status and an
// upstream `cause`, so a UI can render a precise message without re-deriving it.

/** Shared base so `instanceof DataControllerError` catches the whole taxonomy. */
export abstract class DataControllerError extends Error {
  /** The resource URL the failing read targeted. */
  readonly url: string;
  /** The HTTP status, when the failure came from a response (else undefined). */
  readonly status?: number;

  protected constructor(
    message: string,
    url: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.url = url;
    this.status = options?.status;
    // Restore the prototype chain for instanceof across the transpile target.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The resource does not exist (404 / 410). A consumer may create it. */
export class NotFoundError extends DataControllerError {
  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    super(`Resource not found: ${url}`, url, options);
  }
}

/** Authentication is required or the agent is forbidden (401 / 403). */
export class AccessDeniedError extends DataControllerError {
  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    super(`Access denied: ${url}`, url, options);
  }
}

/** A transport-level failure, an abort, or a non-2xx that is not 401/403/404/410. */
export class NetworkError extends DataControllerError {
  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    super(
      options?.status !== undefined
        ? `Request to ${url} failed with status ${options.status}`
        : `Network error fetching ${url}`,
      url,
      options,
    );
  }
}

/** A 2xx response whose body could not be parsed as the requested representation. */
export class DataFormatError extends DataControllerError {
  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    super(`Could not parse data from ${url}`, url, options);
  }
}

/**
 * Map an arbitrary failure (a `@jeswr/fetch-rdf` `RdfFetchError`, a thrown
 * `Response`-shaped object, an `AbortError`, or any other error) onto the
 * 4-class taxonomy. Centralised so every read path classifies identically.
 *
 * `status` (when known) drives the choice: 404/410 → NotFound, 401/403 → Denied,
 * any other non-2xx → Network. A 2xx that threw is a parse failure → DataFormat.
 * No status at all is a transport failure → Network.
 */
export function classifyReadError(
  url: string,
  error: unknown,
  hints?: { status?: number; parsed?: boolean },
): DataControllerError {
  if (error instanceof DataControllerError) return error;

  // Pull a status off the error if it (or its cause) exposes one, else from hints.
  const status = hints?.status ?? numericStatus(error);

  if (status !== undefined) {
    if (status === 404 || status === 410) return new NotFoundError(url, { status, cause: error });
    if (status === 401 || status === 403)
      return new AccessDeniedError(url, { status, cause: error });
    if (status >= 200 && status < 300) return new DataFormatError(url, { status, cause: error });
    return new NetworkError(url, { status, cause: error });
  }

  // A successful fetch whose body failed to parse: a format problem, not network.
  if (hints?.parsed === false) return new DataFormatError(url, { cause: error });

  return new NetworkError(url, { cause: error });
}

/** Best-effort extraction of an HTTP status from an unknown error or its cause. */
function numericStatus(error: unknown): number | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (candidate && typeof candidate === "object" && "status" in candidate) {
      const s = (candidate as { status?: unknown }).status;
      if (typeof s === "number" && Number.isFinite(s)) return s;
    }
  }
  return undefined;
}
