// AUTHORED-BY Codex GPT-6.1-Sol
export { dryRunRules, evaluateRules } from "./engine";
export type {
  MailAction,
  MailCondition,
  MailMessage,
  MailRule,
  MailRuleMatch,
  MailRulePlan,
  MailRulesReport,
} from "./types";
export { MailRulesError, type MailRulesErrorCode, validateRules } from "./validation";
