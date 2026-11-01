import { redactCause, redactText, redactUrl } from "./redact.js";

/**
 * Typed error class for fetch/parse failures. Cancellation throws AbortError.
 *
 * Carries optional context — HTTP status, final URL, and the response
 * `Content-Type` we attempted to parse — so callers can distinguish
 * "transport failed" from "server returned 404" from "we can't parse this
 * media type" without string-matching the message.
 *
 * @packageDocumentation
 */

/** Optional context fields attached to an {@link RdfFetchError}. */
export interface RdfFetchErrorOptions {
  /** Machine-readable category for budget and redirect failures. */
  code?: "PARSE_LIMIT" | "REDIRECT";
  /** The cause, with credential-bearing URLs redacted. */
  cause?: unknown;
  /** HTTP status code, if the error originated from an HTTP response. */
  status?: number;
  /** The final URL after redirects, without userinfo, query or fragment. */
  url?: string;
  /** The raw `Content-Type` header value of the response, if known. */
  contentType?: string;
}

/**
 * Single error type for fetch + parse failures.
 *
 * The deliberate decision is one error class with discriminator fields,
 * rather than a hierarchy. Solid clients almost always branch on
 * `status` or "did parsing fail", and a flat shape keeps the public
 * surface small. If callers need finer granularity later we can add
 * subclasses without breaking the existing import.
 */
export class RdfFetchError extends Error {
  /** Machine-readable category for budget and redirect failures. */
  code?: "PARSE_LIMIT" | "REDIRECT";
  /** The cause, with credential-bearing URLs redacted. */
  override cause?: unknown;
  /** HTTP status code from a non-2xx response, if applicable. */
  status?: number;
  /** The final request URL, redacted, if known. */
  url?: string;
  /** Raw `Content-Type` header from the response, if known. */
  contentType?: string;

  constructor(message: string, options: RdfFetchErrorOptions = {}) {
    super(redactText(message));
    this.name = "RdfFetchError";
    if (options.code !== undefined) this.code = options.code;
    if (options.cause !== undefined) this.cause = redactCause(options.cause);
    if (options.status !== undefined) this.status = options.status;
    if (options.url !== undefined) this.url = redactUrl(options.url);
    if (options.contentType !== undefined) this.contentType = options.contentType;
  }
}
