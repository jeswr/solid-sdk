// AUTHORED-BY Codex GPT-6.1-Sol
import type { MailCondition, MailMessage, MailRule, MailRulePlan, MailRulesReport } from "./types";
import { moveDestination, validateMessage, validateRules } from "./validation";

function matches(message: MailMessage, condition: MailCondition): boolean {
  if ("match" in condition) {
    return condition.match === "all"
      ? condition.conditions.every((child) => matches(message, child))
      : condition.conditions.some((child) => matches(message, child));
  }
  if (condition.field === "has-attachment") {
    return message.hasAttachment === condition.value;
  }
  if (condition.field === "size") {
    switch (condition.operator) {
      case "equals":
        return message.size === condition.value;
      case "greater-than":
        return message.size > condition.value;
      case "less-than":
        return message.size < condition.value;
    }
  }
  const texts = message[condition.field];
  const values = typeof texts === "string" ? [texts] : texts;
  return values.some((text) =>
    condition.operator === "equals" ? text === condition.value : text.includes(condition.value),
  );
}

/** Array order is priority. Match every rule against the original message, without mutation. */
export function dryRunRules(message: MailMessage, rules: readonly MailRule[]): MailRulesReport {
  validateMessage(message);
  validateRules(rules);
  const labels = new Set<string>();
  let moveTo: string | null = null;
  let markRead = false;
  let star = false;
  let stoppedByRuleId: string | null = null;
  const report = rules.map((rule) => {
    const matched = matches(message, rule.condition);
    const applied = matched && stoppedByRuleId === null;
    if (applied) {
      for (const action of rule.actions) {
        switch (action.type) {
          case "label":
            labels.add(action.label);
            break;
          case "move":
            moveTo = moveDestination(moveTo, action.folder);
            break;
          case "mark-read":
            markRead = true;
            break;
          case "star":
            star = true;
            break;
          case "stop-processing":
            stoppedByRuleId = rule.id;
            break;
        }
      }
    }
    return { ruleId: rule.id, matched, applied };
  });
  return {
    rules: report,
    plan: { labels: [...labels], moveTo, markRead, star, stoppedByRuleId },
  };
}

/** Returns an action plan; performs no I/O. Identical validation and ordering to dry-run. */
export function evaluateRules(message: MailMessage, rules: readonly MailRule[]): MailRulePlan {
  return dryRunRules(message, rules).plan;
}
