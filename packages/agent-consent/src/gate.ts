// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The outbound gate for a consumer agent's purchases, data sharing and step-up requests.
 * Every action the core proposes runs the six checks in order: mandate, recipient,
 * disclosure, data terms, limits and approval, evidence. The first check that does not
 * pass decides: `ask` (ask the principal) or `fail` (stop). Later checks are not run and
 * show as pending. Nothing the model writes reaches these checks except the action itself.
 *
 * Inputs are already verified: spending rules and approvals come from records whose device
 * signatures the caller checked (signing.ts), never from the model or a counterparty.
 */
import { formatMoney, type Money } from "./money.js";
import { checkSpend, type SpendCheck, type SpendRecord } from "./spend.js";
import { describeRule } from "./summary.js";
import type {
  ApprovalKind,
  CheckLine,
  OutboundCheck,
  Outcome,
  ProposedAction,
  PurchaseAction,
  ShareAction,
  StepUpAction,
} from "./types.js";

/** What the principal's mandate says, in the terms this gate needs. */
export interface PrincipalPolicy {
  /** Purchase categories the agent may buy in at all (with approval unless a rule covers). */
  readonly purchaseCategories: readonly string[];
  /** No purchase above this goes ahead without an approval of that exact purchase. */
  readonly singleActionCeiling: Money;
  /** Data kinds the agent must never share. */
  readonly neverShare: readonly string[];
  /** Longest retention the principal accepts without being asked. */
  readonly maxRetentionDays: number;
}

export interface GateInput {
  readonly action: ProposedAction;
  readonly digest: string;
  readonly policy: PrincipalPolicy;
  /** Verified, in-force spending rules. */
  readonly rules: readonly unknown[];
  readonly records: readonly SpendRecord[];
  /** Digests the principal approved (verified, unexpired, unused). */
  readonly approvals: ReadonlySet<string>;
  /** Digests for which a step-up attestation was received and verified. */
  readonly attestations: ReadonlySet<string>;
  readonly now: Date;
}

export interface GateResult {
  readonly outcome: Outcome;
  readonly checks: readonly CheckLine[];
  /** Which check asked or stopped, and why (absent on go). */
  readonly decidedBy?: { readonly check: OutboundCheck; readonly reason: string };
  readonly kind?: ApprovalKind;
  /** How the purchase stood against the spending rules (purchases only). */
  readonly spend?: SpendCheck;
  /** "approval" when an approval of this digest let it through, "rule" when a spending rule did. */
  readonly basis?: "approval" | "rule" | "attestation";
}

export const CHECK_ORDER: readonly OutboundCheck[] = [
  "mandate",
  "recipient",
  "disclosure",
  "data-terms",
  "limits-and-approval",
  "evidence",
];

type Decisive =
  | {
      readonly result: "ask";
      readonly plain: string;
      readonly code: string;
      readonly kind: ApprovalKind;
    }
  | { readonly result: "fail"; readonly plain: string; readonly code: string };
type Step =
  | { readonly result: "pass"; readonly plain: string; readonly code: string }
  | { readonly result: "not-applicable"; readonly plain: string }
  | Decisive;

const pass = (plain: string, code: string): Step => ({ result: "pass", plain, code });
const na = (plain: string): Step => ({ result: "not-applicable", plain });

function recipientStep(action: ProposedAction, approved: boolean): Step {
  const r = action.recipient;
  if (r.established === "not-established" && approved)
    return pass(`You approved this interaction with ${r.name} once.`, "approved-once-recipient");
  if (r.established === "not-established")
    return {
      result: "ask",
      plain: `I could not confirm who ${r.name} is from your list or a register.`,
      code: "recipient-not-established",
      kind: "new-recipient",
    };
  const how =
    r.established === "own-list"
      ? "on your list"
      : r.established === "root"
        ? "vouched for by a root you trust"
        : "found through the sector register";
  return pass(`${r.name} is who it says it is (${how}).`, "recipient-established");
}

function purchaseSteps(
  input: GateInput,
  a: PurchaseAction,
): { steps: Step[]; spend?: SpendCheck; basis?: GateResult["basis"] } {
  const steps: Step[] = [];
  if (a.origin === "content")
    return {
      steps: [
        {
          result: "fail",
          plain: "No rule lets me add things you did not ask for. This came from page content.",
          code: "not-authorised",
        },
      ],
    };
  if (!input.policy.purchaseCategories.includes(a.category))
    return {
      steps: [
        {
          result: "fail",
          plain: `Your rules do not let me buy ${a.category}.`,
          code: "prohibited",
        },
      ],
    };
  steps.push(pass(`Your rules allow buying ${a.category}.`, "within-mandate"));
  const recipient = recipientStep(a, input.approvals.has(input.digest));
  steps.push(recipient);
  if (recipient.result !== "pass") return { steps };
  steps.push(
    pass(`Only your name and delivery address go to ${a.recipient.name}.`, "minimal-disclosure"),
  );
  steps.push(pass(`${a.recipient.name} may use them for delivery only.`, "terms-allow"));
  const spend = checkSpend(
    input.rules,
    input.records,
    { merchant: a.recipient.id, category: a.category, amount: a.total },
    input.now,
  );
  if (input.approvals.has(input.digest)) {
    steps.push(pass("You approved this exact purchase.", "approval-given"));
    return { steps, spend, basis: "approval" };
  }
  if (a.reversibility === "irreversible") {
    steps.push({
      result: "ask",
      plain: "This cannot be undone, so I need your approval for this exact purchase.",
      code: "irreversible",
      kind: "purchase",
    });
    return { steps, spend };
  }
  const ceiling = input.policy.singleActionCeiling;
  const overCeiling = a.total.currency !== ceiling.currency || a.total.minor > ceiling.minor;
  if (spend.outcome === "covered" && !overCeiling) {
    steps.push(pass(`Inside ${describeRule(spend.usage.rule)}.`, "within-limits"));
    return { steps, spend, basis: "rule" };
  }
  if (spend.outcome === "exceeds" && !overCeiling) {
    steps.push({
      result: "ask",
      plain: `This goes over ${describeRule(spend.usage.rule)}.`,
      code: "limit-exceeded",
      kind: "limit-exceeded",
    });
    return { steps, spend };
  }
  steps.push({
    result: "ask",
    plain: overCeiling
      ? `Purchases over ${formatMoney(ceiling)} always need your OK.`
      : `Your rules say to ask before any purchase at ${a.recipient.name}.`,
    code: "owner-approval",
    kind: "purchase",
  });
  return { steps, spend };
}

function shareSteps(
  input: GateInput,
  a: ShareAction,
): { steps: Step[]; basis?: GateResult["basis"] } {
  if (a.origin === "content")
    return {
      steps: [
        {
          result: "fail",
          plain: "Sharing your data was asked for by content, not by you.",
          code: "not-authorised",
        },
      ],
    };
  const offered = a.fields.filter((f) => f.state === "offered");
  const banned = offered.find((f) => input.policy.neverShare.includes(f.kind));
  if (banned)
    return {
      steps: [
        {
          result: "fail",
          plain: `Your rules say never to share ${banned.label.toLowerCase()}.`,
          code: "prohibited",
        },
      ],
    };
  if (offered.length === 0)
    return {
      steps: [{ result: "fail", plain: "There is nothing left to share.", code: "no-data" }],
    };
  const steps: Step[] = [pass("Your rules allow sharing these with your OK.", "within-mandate")];
  const recipient = recipientStep(a, input.approvals.has(input.digest));
  steps.push(recipient);
  if (recipient.result !== "pass") return { steps };
  const approved = input.approvals.has(input.digest);
  const withheld = a.fields.length - offered.length;
  const declined = withheld > 0 ? ` I declined ${withheld} you do not need to share.` : "";
  if (!approved) {
    steps.push({
      result: "ask",
      plain: `${a.recipient.name} asks for ${offered.length === 1 ? "one thing" : `${offered.length} things`} about you.${declined}`,
      code: "owner-approval",
      kind: "disclosure",
    });
    return { steps };
  }
  steps.push(pass(`You approved sharing exactly these.${declined}`, "approval-given"));
  const days = a.terms.retentionDays;
  steps.push(
    days !== undefined && days > input.policy.maxRetentionDays
      ? pass(
          `You allowed ${days} days this time (your rule is ${input.policy.maxRetentionDays}).`,
          "approval-given",
        )
      : pass(
          `Used for ${a.terms.purpose.toLowerCase()}${days !== undefined ? `, kept ${days} days` : ""}.`,
          "terms-allow",
        ),
  );
  steps.push(na("No money moves."));
  return { steps, basis: "approval" };
}

function stepUpSteps(
  input: GateInput,
  a: StepUpAction,
): { steps: Step[]; basis?: GateResult["basis"] } {
  const steps: Step[] = [pass("Your rules allow this with your OK.", "within-mandate")];
  const recipient = recipientStep(a, input.approvals.has(input.digest));
  steps.push(recipient);
  if (recipient.result !== "pass") return { steps };
  steps.push(na("The check itself shares nothing with them."));
  steps.push(na("No data terms apply to the check."));
  if (input.attestations.has(input.digest)) {
    steps.push(pass(`${a.performedBy} confirmed it is you.`, "approval-given"));
    return { steps, basis: "attestation" };
  }
  steps.push({
    result: "ask",
    plain: `${a.recipient.name} asks for a stronger approval before it releases ${a.releases}.`,
    code: "assurance-insufficient",
    kind: "step-up",
  });
  return { steps };
}

/** Run the outbound gate. Pure: the same input always gives the same result. */
export function evaluateAction(input: GateInput): GateResult {
  const a = input.action;
  const run =
    a.type === "purchase"
      ? purchaseSteps(input, a)
      : a.type === "share"
        ? shareSteps(input, a)
        : stepUpSteps(input, a);
  const decisive = run.steps.find((s): s is Decisive => s.result === "ask" || s.result === "fail");
  const checks: CheckLine[] = CHECK_ORDER.map((check, i) => {
    const s = run.steps[i];
    if (s)
      return { check, result: s.result, plain: s.plain, ...("code" in s ? { code: s.code } : {}) };
    if (check === "evidence" && !decisive)
      return {
        check,
        result: "pass",
        plain: "A signed record of this decision is kept.",
        code: "record-kept",
      };
    return {
      check,
      result: "pending",
      plain:
        decisive?.result === "fail"
          ? "Not checked: an earlier check stopped this."
          : "Waiting for your answer.",
    };
  });
  const spendCheck = (run as { spend?: SpendCheck }).spend;
  const spend: { spend?: SpendCheck } = spendCheck ? { spend: spendCheck } : {};
  // Every path that passes all its steps sets a basis (approval, rule or attestation).
  if (!decisive)
    return {
      outcome: "go",
      checks,
      basis: run.basis as NonNullable<GateResult["basis"]>,
      ...spend,
    };
  const index = run.steps.indexOf(decisive);
  const check = CHECK_ORDER[index] as OutboundCheck;
  return {
    outcome: decisive.result === "fail" ? "stop" : "ask",
    checks,
    decidedBy: { check, reason: decisive.code },
    ...(decisive.result === "ask" ? { kind: decisive.kind } : {}),
    ...spend,
  };
}
