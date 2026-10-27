// AUTHORED-BY Codex GPT-6.1-Sol

/** Matching window before typing, measured in UTF-16 code units; longer blocks are accepted. */
export const MAX_AUTOFORMAT_CONTEXT_LENGTH = 512;
/** One Unicode scalar value occupies at most two UTF-16 code units. */
export const MAX_TYPED_CHARACTER_LENGTH = 2;

export const AUTOFORMAT_RULE_IDS = Object.freeze([
  "en-dash",
  "em-dash",
  "ellipsis",
  "copyright",
  "registered",
  "trademark",
  "right-arrow",
  "left-arrow",
  "double-arrow",
  "half",
  "quarter",
  "three-quarters",
  "double-quotes",
  "single-quotes",
] as const);

export type AutoformatRuleId = (typeof AUTOFORMAT_RULE_IDS)[number];
/** All rules default to enabled. Only an explicit false disables a rule. */
export type AutoformatOptions = Readonly<Partial<Record<AutoformatRuleId, boolean>>>;

export interface AutoformatContext {
  readonly inCode: boolean;
  readonly rules?: AutoformatOptions;
}

export interface AutoformatReplacement {
  /** UTF-16 offsets into textBefore + typed, with an exclusive to. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  /** Exact replaced text, suitable for immediate Backspace undo. */
  readonly original: string;
  readonly rule: AutoformatRuleId;
}

export type AutoformatErrorCode = "INVALID_TEXT" | "UNKNOWN_RULE" | "INVALID_OPTIONS";

export class AutoformatError extends Error {
  readonly name = "AutoformatError";

  constructor(
    readonly code: AutoformatErrorCode,
    message: string,
  ) {
    super(message);
  }
}
