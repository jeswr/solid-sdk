// AUTHORED-BY Codex GPT-6.1-Sol

/** Decoded, complete message fields; size is the original message size in bytes. */
export interface MailMessage {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly hasAttachment: boolean;
  readonly size: number;
}

export type MailCondition =
  | {
      readonly field: "from" | "to" | "subject" | "body";
      readonly operator: "equals" | "contains";
      readonly value: string;
    }
  | { readonly field: "has-attachment"; readonly value: boolean }
  | {
      readonly field: "size";
      readonly operator: "equals" | "greater-than" | "less-than";
      readonly value: number;
    }
  | { readonly match: "all" | "any"; readonly conditions: readonly MailCondition[] };

export type MailAction =
  | { readonly type: "label"; readonly label: string }
  | { readonly type: "move"; readonly folder: string }
  | { readonly type: "mark-read" | "star" | "stop-processing" };

export interface MailRule {
  readonly id: string;
  readonly condition: MailCondition;
  readonly actions: readonly MailAction[];
}

export interface MailRuleMatch {
  readonly ruleId: string;
  readonly matched: boolean;
  /** False for nonmatches and every rule after a matching stop-processing action. */
  readonly applied: boolean;
}

/** A plan only: the caller performs persistence after reviewing the complete result. */
export interface MailRulePlan {
  readonly labels: readonly string[];
  readonly moveTo: string | null;
  readonly markRead: boolean;
  readonly star: boolean;
  readonly stoppedByRuleId: string | null;
}

export interface MailRulesReport {
  readonly rules: readonly MailRuleMatch[];
  readonly plan: MailRulePlan;
}
