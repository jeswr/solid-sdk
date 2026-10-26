// AUTHORED-BY Codex GPT-6.1-Sol
export type DedupeErrorCode =
  | "invalid-email"
  | "invalid-phone"
  | "invalid-country-code"
  | "invalid-name"
  | "invalid-webid"
  | "invalid-contact"
  | "duplicate-id"
  | "invalid-options";

/** Fail-closed error; never echoes caller-supplied contact data. */
export class DedupeError extends Error {
  constructor(public readonly code: DedupeErrorCode) {
    super(`Contact dedupe: ${code}`);
    this.name = "DedupeError";
  }
}

export function text(value: string, code: DedupeErrorCode): void {
  if (typeof value !== "string" || !value.isWellFormed() || value.trim() === "") {
    throw new DedupeError(code);
  }
}
