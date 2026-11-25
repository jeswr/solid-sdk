// AUTHORED-BY Claude Sonnet 5.5

/** The closed set of failure kinds. Callers branch on `code` only. */
export type MediaErrorCode =
  | "out-of-scope"
  | "not-found"
  | "forbidden"
  | "too-large"
  | "over-budget"
  | "unsupported-type"
  | "offline"
  | "aborted"
  | "purged"
  | "failed";

/** A failure. `message` is a fixed sentence per code: it never carries a URL, header or server text. */
export interface MediaError {
  readonly code: MediaErrorCode;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MediaError };

const MESSAGES: Readonly<Record<MediaErrorCode, string>> = {
  "out-of-scope": "The resource is outside the allowed scope.",
  "not-found": "The resource does not exist.",
  forbidden: "Access to the resource is not allowed.",
  "too-large": "The resource is too large to display.",
  "over-budget": "The media memory budget is exhausted.",
  "unsupported-type": "The resource is not a supported media type.",
  offline: "The pod could not be reached.",
  aborted: "The request was cancelled.",
  purged: "The media cache was cleared.",
  failed: "The resource could not be loaded.",
};

export function fail(code: MediaErrorCode): { readonly ok: false; readonly error: MediaError } {
  return { ok: false, error: Object.freeze({ code, message: MESSAGES[code] }) };
}

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

/** Internal control flow: thrown below the read pipeline, converted to a `Result` at its edge. */
export class MediaFailure extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode) {
    super(code);
    this.name = "MediaFailure";
    this.code = code;
  }
}

/** Map a thrown storage-client error to a closed code by duck-typing its `code` string. */
export function codeOfStorageError(error: unknown): MediaErrorCode {
  let code: unknown;
  try {
    code = (error as { code?: unknown } | null)?.code;
  } catch {
    return "failed"; // a hostile getter
  }
  switch (code) {
    case "not-found":
      return "not-found";
    case "forbidden":
    case "unauthenticated":
      return "forbidden";
    case "payload-too-large":
      return "too-large";
    case "scope":
      return "out-of-scope";
    case "network":
      return "offline";
    default:
      return "failed";
  }
}
