// AUTHORED-BY Codex GPT-6.1-Sol
import { AccessDeniedError } from "./errors.js";

/** The extension's class-scoped consent request, forwarded without modification. */
export interface AccessRequest {
  /** Non-empty absolute HTTP(S) data-class IRIs. */
  readonly classes: readonly string[];
  /** Read/Append/Write ACL IRIs or the extension's read/append/write short modes. */
  readonly modes: readonly string[];
  readonly purpose?: string;
  /** ISO-8601 duration (for example P30D); expiry validation belongs to the extension. */
  readonly duration?: string;
}

/** Consent outcome; approval requires both a successful reply and non-empty grants. */
export interface AccessRequestResult {
  readonly ok: boolean;
  readonly granted: boolean;
}

/** The target does not expose the extension's callable requestAccess capability. */
export class RequestAccessUnavailableError extends Error {
  constructor() {
    super("The Solid extension's requestAccess capability is unavailable.");
    this.name = "RequestAccessUnavailableError";
  }
}

interface AccessExtension {
  requestAccess(request: AccessRequest): Promise<{
    readonly ok: boolean;
    readonly grants: readonly unknown[];
  }>;
}

function accessExtension(target: unknown): AccessExtension | undefined {
  const solid = (target as { solid?: Partial<AccessExtension> | null } | null)?.solid;
  return typeof solid?.requestAccess === "function" ? (solid as AccessExtension) : undefined;
}

/** Feature detection only: no login, prompt, fetch, or extension marker is required. */
export function canRequestAccess(target: unknown = globalThis): boolean {
  return accessExtension(target) !== undefined;
}

/**
 * Offer extension consent after an AccessDeniedError. Reject invalid scope before
 * prompting, preserve the exact request object, and leave retries to the caller.
 * Never logs in or reads data. Extension failures propagate to the caller.
 *
 * @throws {TypeError} For another error type or invalid classes/modes.
 * @throws {RequestAccessUnavailableError} If requestAccess is not callable.
 */
export async function requestAccessAfterDenial(
  error: unknown,
  request: AccessRequest,
  target: unknown = globalThis,
): Promise<AccessRequestResult> {
  if (!(error instanceof AccessDeniedError)) {
    throw new TypeError("requestAccessAfterDenial requires an AccessDeniedError.");
  }
  if (request === null || typeof request !== "object") {
    throw new TypeError("An access request is required.");
  }
  validateScope(request.classes, isHttpIri, "classes must contain absolute HTTP(S) IRIs");
  validateScope(request.modes, isSupportedMode, "modes must contain supported access modes");

  const solid = accessExtension(target);
  if (!solid) throw new RequestAccessUnavailableError();
  const response = await solid.requestAccess(request);
  const ok = response?.ok === true;
  return { ok, granted: ok && Array.isArray(response.grants) && response.grants.length > 0 };
}

function validateScope(
  values: unknown,
  isValid: (value: unknown) => boolean,
  message: string,
): void {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(message);
  // Iteration checks sparse array slots too; Array.every would silently skip them.
  for (const value of values) {
    if (!isValid(value)) throw new TypeError(message);
  }
}

function isHttpIri(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    !/^https?:\/\/[^/?#]/i.test(value) ||
    /[\s<>"{}|\\^`\p{Cc}\p{Cs}]/u.test(value) ||
    /%(?![\da-f]{2})/i.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const SHORT_MODES = new Set(["read", "append", "write"]);
const ACL_MODES = new Set([
  "http://www.w3.org/ns/auth/acl#Read",
  "http://www.w3.org/ns/auth/acl#Append",
  "http://www.w3.org/ns/auth/acl#Write",
]);

function isSupportedMode(value: unknown): boolean {
  // Matches the extension's normaliseMode; never infer modes from arbitrary IRIs.
  return (
    typeof value === "string" &&
    (ACL_MODES.has(value) || SHORT_MODES.has(value.trim().toLowerCase()))
  );
}
