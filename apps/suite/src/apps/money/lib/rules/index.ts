// AUTHORED-BY Codex GPT-6.1-Sol
export { applyRules } from "./engine";
export { reconcile } from "./reconciliation";
export { detectTransfers } from "./transfers";
export type {
  CategorisationRule,
  MoneyTransaction,
  ReconciliationInput,
  ReconciliationResult,
  RuleResult,
  TextCondition,
  TransferMatch,
  TransferOptions,
} from "./types";
export { MoneyRulesError, type MoneyRulesErrorCode } from "./validation";
