// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { GuardError, PodScopeError, RedirectRefusedError, SsrfError } from "@jeswr/guarded-fetch";
import { IntegrationError } from "../core/errors.js";
import { PodDataError } from "../pod/resource.js";

/** Stable CLI failure categories. Messages never contain transport errors or credentials. */
export class NodeRuntimeError extends Error {
  constructor(
    readonly kind: "config" | "auth" | "import" | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "NodeRuntimeError";
  }
}

/** A structural refusal (bad ACL discovery, missing ETag, corrupt checkpoint): never transient. */
export class PermanentCauseError extends Error {
  constructor() {
    super("Permanent failure.");
    this.name = "PermanentCauseError";
  }
}

/** Connector state could not be read, protected or saved; `transient` drives watch retries. */
export class StateStoreError extends NodeRuntimeError {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super("import", message);
    this.name = "StateStoreError";
  }
}

const TRANSIENT_STATUSES = new Set([408, 412, 429]);
/** The HTTP status carried by a typed Pod/RDF error, if any. */
export function httpStatus(error: unknown): number | undefined {
  const status =
    error !== null && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}
/** Only 5xx, request timeouts (408) and precondition races (412: another writer won) retry. */
export function isTransientStatus(status: number): boolean {
  return status >= 500 || TRANSIENT_STATUSES.has(status);
}
/**
 * Network faults, timeouts and token-exchange hiccups (untyped errors) are transient; HTTP
 * refusals follow their status, and typed policy refusals (scope, redirects, connector
 * validation, structural state problems) are permanent.
 */
export function isTransientCause(error: unknown): boolean {
  if (error instanceof StateStoreError) return error.transient;
  const status = httpStatus(error);
  if (status !== undefined) return isTransientStatus(status);
  return !(
    error instanceof PermanentCauseError ||
    error instanceof IntegrationError ||
    error instanceof NodeRuntimeError ||
    error instanceof PodDataError ||
    error instanceof PodScopeError ||
    error instanceof SsrfError ||
    error instanceof GuardError ||
    error instanceof RedirectRefusedError
  );
}

/** Validate file and programmatic source settings with the same unprivileged port range. */
export function validateCallbackPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535)
    throw new NodeRuntimeError("config", "callbackPort must be an integer from 1024 to 65535.");
  return value;
}

/** Validate a configured HTTPS URL without accepting embedded credentials. */
export function httpsUrl(value: unknown, allowFragment = false): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (!allowFragment && url.hash))
    throw new Error("Invalid URL");
  return url.href;
}

/** Narrow JSON objects without trusting an asserted TypeScript interface. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid object");
  return value as Record<string, unknown>;
}

/** Require a nonempty string without incorporating its value in diagnostics. */
export function textValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid string");
  return value;
}
