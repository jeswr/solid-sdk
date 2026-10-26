// AUTHORED-BY Codex GPT-6.1-Sol
export type UnitErrorCode =
  | "unknown-unit"
  | "unknown-measure"
  | "incompatible-unit"
  | "invalid-value"
  | "invalid-observation"
  | "numeric-range";

/** Machine-readable failures; messages never include observation values. */
export class UnitError extends Error {
  readonly code: UnitErrorCode;

  constructor(code: UnitErrorCode, message: string) {
    super(message);
    this.name = "UnitError";
    this.code = code;
  }
}
