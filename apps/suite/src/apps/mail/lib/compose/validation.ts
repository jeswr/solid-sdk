// AUTHORED-BY Codex GPT-6.1-Sol
import type { MailAddress } from "./types";

export type ComposeErrorCode = "invalid-input" | "unsupported-address" | "invalid-source";
export class ComposeError extends Error {
  constructor(
    public readonly code: ComposeErrorCode,
    public readonly field: string,
  ) {
    super(`Cannot compose message: ${code} (${field})`);
    this.name = "ComposeError";
  }
}
export function requireInput(condition: unknown, field: string): asserts condition {
  if (!condition) throw new ComposeError("invalid-input", field);
}
export function record(value: unknown, field: string): asserts value is Record<string, unknown> {
  requireInput(typeof value === "object" && value !== null && !Array.isArray(value), field);
}
export function text(value: unknown, field: string): asserts value is string {
  requireInput(typeof value === "string" && value.isWellFormed(), field);
}
export function headerText(value: unknown, field: string): asserts value is string {
  text(value, field);
  requireInput(!/[\p{Cc}]/u.test(value), field);
}
export function domain(value: unknown): asserts value is string {
  requireInput(
    typeof value === "string" &&
      value.length <= 253 &&
      value.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)),
    "domain",
  );
}
export function mailbox(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[a-z0-9.-]+$/i.test(
      value,
    ) ||
    value.slice(0, value.indexOf("@")).length > 64
  ) {
    throw new ComposeError("unsupported-address", "email");
  }
  domain(value.slice(value.indexOf("@") + 1));
}
export function address(value: unknown): asserts value is MailAddress {
  record(value, "address");
  mailbox(value.email);
  if (value.name !== undefined) {
    headerText(value.name, "name");
    requireInput(value.name.length > 0, "name");
  }
}
export function addresses(value: unknown): asserts value is readonly MailAddress[] {
  requireInput(Array.isArray(value), "addresses");
  for (const item of value) address(item);
}
export function messageId(value: unknown): asserts value is string {
  requireInput(typeof value === "string" && /^<[^<>]+>$/.test(value), "messageId");
  mailbox(value.slice(1, -1));
}
export function threading(value: { inReplyTo?: string; references?: readonly string[] }) {
  if (value.inReplyTo !== undefined) messageId(value.inReplyTo);
  if (value.references !== undefined) {
    requireInput(Array.isArray(value.references), "references");
    for (const id of value.references) messageId(id);
  }
}
export function date(value: unknown): asserts value is Date {
  requireInput(
    value instanceof Date &&
      Number.isFinite(value.getTime()) &&
      value.getUTCFullYear() >= 1900 &&
      value.getUTCFullYear() <= 9999,
    "date",
  );
}
export function key(email: string): string {
  const at = email.indexOf("@");
  return email.slice(0, at) + email.slice(at).toLowerCase();
}
