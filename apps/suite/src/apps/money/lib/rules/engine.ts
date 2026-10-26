// AUTHORED-BY Codex GPT-6.1-Sol
import type { CategorisationRule, MoneyTransaction, RuleResult, TextCondition } from "./types";
import { identifier, minorUnits, record, requireValue, transaction } from "./validation";

function textCondition(value: unknown): asserts value is TextCondition {
  record(value, ["operator", "value"], "invalid-rule");
  requireValue(value.operator === "contains" || value.operator === "glob", "invalid-rule");
  requireValue(typeof value.value === "string" && value.value.length > 0, "invalid-rule");
  if (value.operator === "glob") {
    requireValue(!/[[\]{}\\]/.test(value.value), "unsupported-glob");
  }
}

function validateRule(value: unknown): asserts value is CategorisationRule {
  record(value, ["id", "priority", "conditions", "actions"], "invalid-rule");
  identifier(value.id);
  requireValue(Number.isSafeInteger(value.priority), "invalid-rule");
  record(value.conditions, ["payee", "memo", "amount", "accountId"], "invalid-rule");
  const conditions = value.conditions;
  if ("payee" in conditions) textCondition(conditions.payee);
  if ("memo" in conditions) textCondition(conditions.memo);
  if ("accountId" in conditions) identifier(conditions.accountId);
  if ("amount" in conditions) {
    record(conditions.amount, ["min", "max"], "invalid-rule");
    const range = conditions.amount;
    requireValue("min" in range || "max" in range, "invalid-rule");
    if ("min" in range) minorUnits(range.min);
    if ("max" in range) minorUnits(range.max);
    if ("min" in range && "max" in range) {
      requireValue((range.min as number) <= (range.max as number), "invalid-rule");
    }
  }
  record(value.actions, ["categoryId", "payee"], "invalid-rule");
  requireValue(Object.keys(value.actions).length > 0, "invalid-rule");
  if ("categoryId" in value.actions) identifier(value.actions.categoryId);
  if ("payee" in value.actions) identifier(value.actions.payee);
}

/** Whole-string wildcard matching over Unicode code points; never compiles a regex. */
function glob(text: string, pattern: string): boolean {
  const input = Array.from(text);
  const tokens = Array.from(pattern);
  let index = 0;
  let token = 0;
  let star = -1;
  let retry = 0;
  while (index < input.length) {
    if (tokens[token] === "*") {
      star = token++;
      retry = index;
    } else if (tokens[token] === "?" || tokens[token] === input[index]) {
      index++;
      token++;
    } else if (star >= 0) {
      token = star + 1;
      index = ++retry;
    } else {
      return false;
    }
  }
  while (tokens[token] === "*") token++;
  return token === tokens.length;
}

function matchesText(text: string, condition: TextCondition): boolean {
  return condition.operator === "contains"
    ? text.includes(condition.value)
    : glob(text, condition.value);
}

function matches(item: MoneyTransaction, { conditions }: CategorisationRule): boolean {
  return (
    (conditions.payee === undefined || matchesText(item.payee, conditions.payee)) &&
    (conditions.memo === undefined || matchesText(item.memo, conditions.memo)) &&
    (conditions.accountId === undefined || item.accountId === conditions.accountId) &&
    (conditions.amount?.min === undefined || item.amount >= conditions.amount.min) &&
    (conditions.amount?.max === undefined || item.amount <= conditions.amount.max)
  );
}

/** Validates every rule before evaluation, including rules after a potential winner. */
export function applyRules(
  item: MoneyTransaction,
  rules: readonly CategorisationRule[],
): RuleResult {
  transaction(item);
  requireValue(Array.isArray(rules), "invalid-rule");
  const ids = new Set<string>();
  for (const rule of rules) {
    validateRule(rule);
    requireValue(!ids.has(rule.id), "invalid-rule");
    ids.add(rule.id);
  }
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const winner = ordered.find((rule) => matches(item, rule));
  if (!winner) return { transaction: { ...item }, matchedRuleId: null };
  return { transaction: { ...item, ...winner.actions }, matchedRuleId: winner.id };
}
