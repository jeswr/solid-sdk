// AUTHORED-BY Codex GPT-6.1-Sol
import type { MailAction, MailCondition, MailMessage, MailRule } from "./types";

export type MailRulesErrorCode = "invalid-message" | "invalid-rule" | "contradictory-actions";

/** Codes contain no message text, addresses, labels or folder names. */
export class MailRulesError extends Error {
  constructor(public readonly code: MailRulesErrorCode) {
    super(`Mail rules: ${code}`);
    this.name = "MailRulesError";
  }
}

function requireValue(value: unknown, code: MailRulesErrorCode): asserts value {
  if (!value) throw new MailRulesError(code);
}

function record(
  value: unknown,
  keys: readonly string[],
  code: MailRulesErrorCode,
): asserts value is Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null, code);
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, code);
  requireValue(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key)),
    code,
  );
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    ),
    code,
  );
}

function array(value: unknown, code: MailRulesErrorCode): asserts value is unknown[] {
  requireValue(Array.isArray(value), code);
  // Dense data arrays only: no holes, extra properties, symbols, or getters.
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === value.length + 1, code);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValue(descriptor?.enumerable && "value" in descriptor, code);
  }
}

function identifier(value: unknown, code: MailRulesErrorCode): void {
  requireValue(typeof value === "string" && value.trim().length > 0, code);
}

function bytes(value: unknown, code: MailRulesErrorCode): void {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, code);
}

export function validateMessage(value: unknown): asserts value is MailMessage {
  const code = "invalid-message";
  record(value, ["from", "to", "subject", "body", "hasAttachment", "size"], code);
  for (const field of ["from", "to"] as const) {
    array(value[field], code);
    for (const address of value[field]) identifier(address, code);
  }
  requireValue(typeof value.subject === "string" && typeof value.body === "string", code);
  requireValue(typeof value.hasAttachment === "boolean", code);
  bytes(value.size, code);
}

function condition(value: unknown, depth: number): asserts value is MailCondition {
  const code = "invalid-rule";
  // Also rejects cycles with a typed error before recursive stack exhaustion.
  requireValue(depth <= 32, code);
  record(value, ["match", "conditions", "field", "operator", "value"], code);
  if ("match" in value) {
    record(value, ["match", "conditions"], code);
    requireValue(value.match === "all" || value.match === "any", code);
    array(value.conditions, code);
    requireValue(value.conditions.length > 0, code);
    for (const child of value.conditions) condition(child, depth + 1);
    return;
  }
  if (value.field === "has-attachment") {
    record(value, ["field", "value"], code);
    requireValue(typeof value.value === "boolean", code);
    return;
  }
  record(value, ["field", "operator", "value"], code);
  if (value.field === "size") {
    requireValue(
      value.operator === "equals" ||
        value.operator === "greater-than" ||
        value.operator === "less-than",
      code,
    );
    bytes(value.value, code);
    return;
  }
  requireValue(["from", "to", "subject", "body"].includes(value.field as string), code);
  requireValue(value.operator === "equals" || value.operator === "contains", code);
  requireValue(typeof value.value === "string" && value.value.length > 0, code);
}

/** Same-folder moves and repeated positive actions are idempotent. */
export function moveDestination(current: string | null, next: string): string {
  requireValue(current === null || current === next, "contradictory-actions");
  return next;
}

function actions(value: unknown): asserts value is readonly MailAction[] {
  const code = "invalid-rule";
  array(value, code);
  requireValue(value.length > 0, code);
  let destination: string | null = null;
  for (const action of value) {
    record(action, ["type", "label", "folder"], code);
    if (action.type === "label") {
      record(action, ["type", "label"], code);
      identifier(action.label, code);
    } else if (action.type === "move") {
      record(action, ["type", "folder"], code);
      identifier(action.folder, code);
      destination = moveDestination(destination, action.folder as string);
    } else {
      record(action, ["type"], code);
      requireValue(["mark-read", "star", "stop-processing"].includes(action.type as string), code);
    }
  }
}

/** Validates all rules, even those unreachable after stop or short-circuit matching. */
export function validateRules(value: unknown): asserts value is readonly MailRule[] {
  array(value, "invalid-rule");
  const ids = new Set<string>();
  for (const rule of value) {
    record(rule, ["id", "condition", "actions"], "invalid-rule");
    identifier(rule.id, "invalid-rule");
    requireValue(!ids.has(rule.id as string), "invalid-rule");
    ids.add(rule.id as string);
    condition(rule.condition, 0);
    actions(rule.actions);
  }
}
