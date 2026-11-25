// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";

/** The closed set of failure kinds. Callers branch on `kind` only. */
export type MediaStoreErrorKind =
  | "not-found"
  | "conflict"
  | "offline"
  | "forbidden"
  | "too-large"
  | "unsupported"
  | "exposed"
  | "failed";

/** Fixed vocabulary of reasons. Never carries a server message, URL query or credential. */
export type MediaStoreReason =
  | "aborted"
  | "invalid-input"
  | "invalid-cursor"
  | "no-library"
  | "out-of-scope"
  | "unsniffable"
  | "type-mismatch"
  | "bytes-too-large"
  | "description-too-large"
  | "hash-mismatch"
  | "description-mismatch"
  | "description-pending"
  | "description-unparseable"
  | "description-invalid"
  | "no-validator"
  | "retries-exhausted"
  | "library-exposed"
  | "exposure-unknown"
  | "name-unavailable"
  | "not-a-document"
  | "journal"
  | "reentrant"
  | "shard-title"
  | "payload-too-large"
  | "insufficient-storage"
  | "storage"
  | "unexpected";

export interface MediaStoreError {
  readonly kind: MediaStoreErrorKind;
  readonly reason: MediaStoreReason;
  /**
   * Resources a failed call created and left behind: media (a retry adopts them by name on
   * Solid, `sweepOrphans` removes them) and, on LWS, a description that could not be removed.
   */
  readonly orphans?: readonly string[];
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MediaStoreError };

/** Internal control-flow exception; converted to a `Result` at each public boundary. */
export class MediaFailure extends Error {
  readonly error: MediaStoreError;
  constructor(kind: MediaStoreErrorKind, reason: MediaStoreReason, orphans?: readonly string[]) {
    super(kind);
    this.name = "MediaFailure";
    this.error = Object.freeze(
      orphans === undefined ? { kind, reason } : { kind, reason, orphans },
    );
  }
}

export function fail(kind: MediaStoreErrorKind, reason: MediaStoreReason): MediaFailure {
  return new MediaFailure(kind, reason);
}

const KIND_BY_CODE: Readonly<Record<string, MediaStoreErrorKind>> = {
  unauthenticated: "forbidden",
  forbidden: "forbidden",
  "not-found": "not-found",
  conflict: "conflict",
  "precondition-failed": "conflict",
  network: "offline",
  "payload-too-large": "too-large",
  "insufficient-storage": "too-large",
  unsupported: "unsupported",
  "unsupported-media-type": "unsupported",
};

/** Map anything thrown inside an operation to the closed union. */
export function toError(cause: unknown, signal: AbortSignal | undefined): MediaStoreError {
  if (signal?.aborted) {
    // An abort outranks whatever it knocked over, but a leak is still reported.
    const orphans = cause instanceof MediaFailure ? cause.error.orphans : undefined;
    return Object.freeze(
      orphans === undefined
        ? { kind: "failed" as const, reason: "aborted" as const }
        : { kind: "failed" as const, reason: "aborted" as const, orphans },
    );
  }
  if (cause instanceof MediaFailure) return cause.error;
  if (cause instanceof StorageError) {
    if (cause.code === "scope") return Object.freeze({ kind: "failed", reason: "out-of-scope" });
    // Over the server's size limit (HTTP 413) and out of quota (HTTP 507) are told apart: the
    // first will never succeed for this body, the second may after space is freed.
    const reason =
      cause.code === "payload-too-large" || cause.code === "insufficient-storage"
        ? cause.code
        : "storage";
    return Object.freeze({ kind: KIND_BY_CODE[cause.code] ?? "failed", reason });
  }
  return Object.freeze({ kind: "failed", reason: "unexpected" });
}

/** Run an operation and convert every outcome to a `Result`; never throws. */
export async function run<T>(
  signal: AbortSignal | undefined,
  op: () => Promise<T>,
): Promise<Result<T>> {
  try {
    if (signal?.aborted) throw fail("failed", "aborted");
    return { ok: true, value: await op() };
  } catch (cause) {
    return { ok: false, error: toError(cause, signal) };
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw fail("failed", "aborted");
}

export function isStorageCode(cause: unknown, ...codes: string[]): boolean {
  return cause instanceof StorageError && codes.includes(cause.code);
}

/** Reject as soon as `signal` aborts, whether or not the wrapped promise ever settles. */
export function abortable<R>(signal: AbortSignal | undefined, promise: Promise<R>): Promise<R> {
  if (signal === undefined) return promise;
  return new Promise<R>((resolve, reject) => {
    const onAbort = () => reject(fail("failed", "aborted"));
    if (signal.aborted) {
      promise.catch(() => undefined);
      return onAbort();
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
