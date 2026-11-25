// AUTHORED-BY Claude Opus 5.5
import { IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import { UnknownAccountError } from "@jeswr/pod-auth/accounts";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import type { StorageErrorCode } from "@jeswr/storage-client";

/** The UI error categories of 01-design-system §9; suite-ui's `errorStateCopy` gives their copy. */
export type ErrorCategory =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "name-taken"
  | "unsupported"
  | "offline"
  | "unreachable"
  | "quota"
  | "too-large"
  | "unknown";

/** A-7: every `StorageErrorCode`; `network` is resolved against connectivity separately. */
const storageCategories: Readonly<Record<StorageErrorCode, ErrorCategory>> = {
  unauthenticated: "reauth",
  forbidden: "forbidden",
  "not-found": "not-found",
  conflict: "name-taken",
  "precondition-failed": "conflict",
  // A 428 means the client omitted a precondition: a bug, not something the user can resolve.
  "precondition-required": "unknown",
  "unsupported-media-type": "unsupported",
  "method-not-allowed": "unsupported",
  "payload-too-large": "too-large",
  "insufficient-storage": "quota",
  "rate-limited": "unreachable",
  "bad-request": "unknown",
  server: "unreachable",
  network: "unreachable",
  "invalid-response": "unknown",
  "not-rdf": "unknown",
  unsupported: "unsupported",
  scope: "unknown",
};

/** HTTP statuses for structural errors that carry `status` but no storage `code`. */
const statusCodes: Readonly<Record<number, StorageErrorCode>> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  410: "not-found",
  412: "precondition-failed",
  413: "payload-too-large",
  429: "rate-limited",
  507: "insufficient-storage",
};

function isStorageCode(code: unknown): code is StorageErrorCode {
  return typeof code === "string" && Object.hasOwn(storageCategories, code);
}

function currentlyOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function fromCode(code: StorageErrorCode, online: boolean): ErrorCategory {
  if (code === "network") return online ? "unreachable" : "offline";
  return storageCategories[code];
}

function fromStatus(status: number, online: boolean): ErrorCategory {
  const code = statusCodes[status];
  if (code !== undefined) return fromCode(code, online);
  if (status === 0) return fromCode("network", online);
  return status >= 500 ? "unreachable" : "unknown";
}

/**
 * Maps an error from the SDK to the category the shell's `<ErrorState>` renders (A-7). Handles
 * `StorageError` (by `code`), `CapabilitiesError`, the pod-auth sign-in errors and any error
 * object carrying a storage `code` or an HTTP `status`. Everything else is `unknown`.
 * `online` defaults to `navigator.onLine`; a network failure while offline is `offline`.
 */
export function classifyError(error: unknown, online = currentlyOnline()): ErrorCategory {
  if (error instanceof IssuerNotAuthorizedError || error instanceof UnknownAccountError) {
    return "reauth";
  }
  if (error instanceof CapabilitiesError) {
    if (error.code === "network") return fromCode("network", online);
    if (error.code === "description-unreachable") {
      // A missing description is the storage's problem, not a missing item: only auth maps through.
      if (error.status === 401) return "reauth";
      return error.status === 403 ? "forbidden" : "unreachable";
    }
    return "unknown";
  }
  if (typeof error !== "object" || error === null) return "unknown";
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (isStorageCode(code)) return fromCode(code, online);
  if (typeof status === "number") return fromStatus(status, online);
  return "unknown";
}
