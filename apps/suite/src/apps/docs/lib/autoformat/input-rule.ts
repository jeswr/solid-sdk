// AUTHORED-BY Codex GPT-6.1-Sol
import {
  AUTOFORMAT_RULE_IDS,
  type AutoformatContext,
  AutoformatError,
  type AutoformatReplacement,
  type AutoformatRuleId,
  isAutoformatError,
  MAX_AUTOFORMAT_CONTEXT_LENGTH,
  MAX_TYPED_CHARACTER_LENGTH,
} from "./types";

interface LiteralRule {
  readonly id: AutoformatRuleId;
  readonly match: string;
  readonly insert: string;
}

// In specification priority order. A single invocation returns at most one edit.
const literals: readonly LiteralRule[] = [
  { id: "en-dash", match: " -- ", insert: " – " },
  { id: "em-dash", match: "---", insert: "—" },
  { id: "ellipsis", match: "...", insert: "…" },
  { id: "copyright", match: "(c)", insert: "©" },
  { id: "registered", match: "(r)", insert: "®" },
  { id: "trademark", match: "(tm)", insert: "™" },
  { id: "right-arrow", match: "->", insert: "→" },
  { id: "left-arrow", match: "<-", insert: "←" },
  { id: "double-arrow", match: "=>", insert: "⇒" },
];
const fractions: readonly LiteralRule[] = [
  { id: "half", match: "1/2", insert: "½" },
  { id: "quarter", match: "1/4", insert: "¼" },
  { id: "three-quarters", match: "3/4", insert: "¾" },
];

function invalidOptions(): never {
  throw new AutoformatError("INVALID_OPTIONS", "Expected boolean flags in plain data objects");
}

/** Read data properties without running getters or accepting inherited configuration. */
function dataFields(value: unknown): Map<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidOptions();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidOptions();
  const fields = new Map<PropertyKey, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalidOptions();
    fields.set(key, descriptor.value);
  }
  return fields;
}

function readContext(context: AutoformatContext): {
  inCode: boolean;
  rules: Map<PropertyKey, unknown>;
} {
  try {
    const fields = dataFields(context);
    for (const key of fields.keys()) {
      if (key !== "inCode" && key !== "rules") invalidOptions();
    }
    const inCode = fields.get("inCode");
    if (typeof inCode !== "boolean") invalidOptions();
    const rules = fields.has("rules") ? dataFields(fields.get("rules")) : new Map();
    for (const [id, enabled] of rules) {
      if (typeof id !== "string" || !AUTOFORMAT_RULE_IDS.includes(id as AutoformatRuleId)) {
        throw new AutoformatError("UNKNOWN_RULE", "Unknown autoformat rule id");
      }
      if (typeof enabled !== "boolean") invalidOptions();
    }
    return { inCode, rules };
  } catch (error) {
    if (isAutoformatError(error)) throw error;
    // Includes unreadable proxies; no native error or input data escapes the boundary.
    invalidOptions();
  }
}

/**
 * textBefore excludes typed, which must be one Unicode scalar value (no paste/IME batch).
 * Apply the returned edit to textBefore + typed. Fractions wait for a non-digit delimiter.
 * Full text is Unicode-validated; only the trailing window participates in matching.
 */
export function autoformatInput(
  textBefore: string,
  typed: string,
  context: AutoformatContext,
): AutoformatReplacement | null {
  if (typeof textBefore !== "string" || typeof typed !== "string") {
    throw new AutoformatError("INVALID_TEXT", "Expected string input without coercion");
  }
  // Check every size bound before Unicode scans, string copies, or rule matching.
  const windowStart = Math.max(0, textBefore.length - MAX_AUTOFORMAT_CONTEXT_LENGTH);
  if (typed.length === 0 || typed.length > MAX_TYPED_CHARACTER_LENGTH) {
    throw new AutoformatError("INVALID_TEXT", "Expected exactly one typed Unicode scalar value");
  }
  if (!textBefore.isWellFormed() || !typed.isWellFormed() || Array.from(typed).length !== 1) {
    throw new AutoformatError("INVALID_TEXT", "Expected well-formed Unicode and one typed scalar");
  }
  const { inCode, rules } = readContext(context);
  if (inCode) return null;

  let before = textBefore.slice(windowStart);
  const first = before.charCodeAt(0);
  // The full input is valid; a low surrogate here is the clipped half of a valid pair.
  if (first >= 0xdc00 && first <= 0xdfff) before = before.slice(1);
  const text = before + typed;
  const to = textBefore.length + typed.length;
  function replacement(
    rule: LiteralRule,
    original: string,
    insert = rule.insert,
  ): AutoformatReplacement {
    return { from: to - original.length, to, insert, original, rule: rule.id };
  }
  for (const rule of literals) {
    if (rules.get(rule.id) === false) continue;
    const original = text.slice(-rule.match.length);
    if (original.toLowerCase() === rule.match) return replacement(rule, original);
  }
  if (!/^\p{Decimal_Number}$/u.test(typed)) {
    for (const rule of fractions) {
      if (
        rules.get(rule.id) !== false &&
        before.endsWith(rule.match) &&
        !/\p{Decimal_Number}$/u.test(before.slice(0, -rule.match.length))
      ) {
        return replacement(rule, rule.match + typed, rule.insert + typed);
      }
    }
  }
  if (typed === '"' || typed === "'") {
    const id = typed === '"' ? "double-quotes" : "single-quotes";
    if (rules.get(id) === false) return null;
    const opening =
      before.length === 0 || /[\s\p{Open_Punctuation}\p{Dash_Punctuation}]$/u.test(before);
    const insert = typed === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
    return replacement({ id, match: typed, insert }, typed);
  }
  return null;
}
