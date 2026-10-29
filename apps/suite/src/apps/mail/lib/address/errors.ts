// AUTHORED-BY Codex GPT-6.1-Sol
export type AddressErrorCode =
  | "invalid-input"
  | "invalid-syntax"
  | "unsupported-syntax"
  | "invalid-domain"
  | "invalid-recipient";

/** Error messages never interpolate recipient data. */
export class AddressError extends Error {
  constructor(public readonly code: AddressErrorCode) {
    super(`Cannot process addresses: ${code}`);
    this.name = "AddressError";
  }
}

export function requireAddress(
  condition: unknown,
  code: AddressErrorCode = "invalid-input",
): asserts condition {
  if (!condition) throw new AddressError(code);
}

export function text(value: unknown): asserts value is string {
  requireAddress(typeof value === "string" && value.isWellFormed());
}

export function record(value: unknown): asserts value is Record<string, unknown> {
  requireAddress(typeof value === "object" && value !== null && !Array.isArray(value));
}

export function displayName(value: unknown): asserts value is string {
  text(value);
  requireAddress(value.length > 0 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
  requireAddress(!/=\?/.test(value), "unsupported-syntax");
}
