// AUTHORED-BY Codex GPT-6
/** E0's deliberately small oracle. It imports no gate, policy engine or mandate evaluator. */
import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { digestOf } from "../core/canonical.js";
import type { ActionIntent, AuthorisationDecision } from "../core/types.js";
import type { ContextItem, ItemTerms } from "../gates/common.js";
import type { OwnerMandate } from "../mechanisms/mandate.js";

export type Reading = "allow" | "approval" | "deny" | "unknown";
export interface EvaluationState {
  actor: string;
  at: string;
  withdrawn: boolean;
  items: readonly ContextItem[];
  approvals: Readonly<Record<string, { id: string; decision: string }>>;
  admissionDigests: readonly string[];
  shownDigests: readonly string[];
}
export interface EvaluationRecord {
  decisions: readonly AuthorisationDecision[];
  /** Persisted gate verdicts can stop an effect after its authorisation was written. */
  releases?: readonly { digest: string; outcome: string }[];
  /** A ledger prefix captured at the boundary, before any release. */
  beforeEffect: boolean;
}
export interface PropertyInput {
  mandate: OwnerMandate | undefined;
  state: EvaluationState;
  proposal: ActionIntent;
  decision: { outcome: string; authorisation: AuthorisationDecision };
  record: EvaluationRecord;
}

function matches(rule: OdrlRule, intent: ActionIntent, actor: string, at: string): boolean | null {
  if (rule.action !== intent.action || (rule.target && rule.target !== intent.target)) return false;
  if (rule.assignee && rule.assignee !== actor) return false;
  if (rule.duties?.length) return null;
  for (const c of rule.constraints ?? []) {
    const left =
      c.leftOperand === "dateTime"
        ? at
        : c.leftOperand === "purpose"
          ? intent.purpose
          : c.leftOperand === "recipient"
            ? intent.recipient
            : undefined;
    if (left === undefined) return null;
    const right = c.rightOperand;
    const values = Array.isArray(right) ? right : [right];
    let ok: boolean;
    switch (c.operator) {
      case "eq":
        ok = left === right;
        break;
      case "neq":
        ok = left !== right;
        break;
      case "isAnyOf":
        ok = values.includes(left);
        break;
      case "isNoneOf":
        ok = !values.includes(left);
        break;
      case "lt":
        ok = left < right;
        break;
      case "lteq":
        ok = left <= right;
        break;
      case "gt":
        ok = left > right;
        break;
      case "gteq":
        ok = left >= right;
        break;
      default:
        return null;
    }
    if (!ok) return false;
  }
  return true;
}

export function readPolicy(
  policy: OdrlPolicy,
  intent: ActionIntent,
  actor: string,
  at: string,
): Reading {
  if (policy.assignee && policy.assignee !== actor) return "deny";
  if (
    policy.profile ||
    policy.obligations?.length ||
    (policy.conflict && policy.conflict !== "prohibit")
  )
    return "unknown";
  const denied = (policy.prohibitions ?? []).map((r) => matches(r, intent, actor, at));
  if (denied.includes(true)) return "deny";
  const allowed = (policy.permissions ?? []).map((r) => matches(r, intent, actor, at));
  if (denied.includes(null) || allowed.includes(null)) return "unknown";
  return allowed.includes(true) ? "allow" : "deny";
}

export function readMandate(
  mandate: OwnerMandate | undefined,
  state: EvaluationState,
  proposal: ActionIntent,
): Reading {
  if (
    !mandate ||
    state.withdrawn ||
    mandate.subject !== state.actor ||
    state.at < mandate.validFrom ||
    state.at >= mandate.validUntil
  )
    return "deny";
  // Standing emergency grants need role and declaration evidence. Keep them unresolved here.
  if (mandate.standing?.some((r) => r.allows.action === proposal.action)) return "unknown";
  const policies = [mandate.autonomous, mandate.withApproval];
  if (
    policies.some((p) =>
      p.prohibitions?.some((r) => matches(r, proposal, state.actor, state.at) === true),
    )
  )
    return "deny";
  const auto = readPolicy(mandate.autonomous, proposal, state.actor, state.at);
  const ask = readPolicy(mandate.withApproval, proposal, state.actor, state.at);
  if ([auto, ask].includes("unknown")) return "unknown";
  if (auto === "allow") return "allow";
  if (ask === "allow")
    return state.approvals[digestOf(proposal)]?.decision === "approve" ? "allow" : "approval";
  return "deny";
}

export function readTerms(
  terms: ItemTerms | undefined,
  item: ContextItem,
  state: EvaluationState,
  proposal: ActionIntent,
): Reading {
  const sharing =
    proposal.action === "distribute" ||
    (Array.isArray(proposal.parameters.evidence) && proposal.parameters.evidence.includes(item.id));
  if (!terms)
    return sharing ? "deny" : proposal.purpose === item.admittedPurpose ? "allow" : "deny";
  const action = sharing ? "distribute" : "use";
  const intent = { ...proposal, action, target: item.id };
  const own = readPolicy({ ...terms.policy, obligations: [] }, intent, state.actor, state.at);
  if (own !== "allow") return own;
  for (const inherited of terms.inherited ?? []) {
    const r = readTerms(
      inherited.terms ?? undefined,
      { ...item, id: inherited.target },
      state,
      proposal,
    );
    if (r !== "allow") return r;
  }
  return terms.recipientMustBe ? "unknown" : "allow";
}

/** Five independent obligations, called for every generated proposal, including non-go. */
export const properties = {
  "A1-mandate": (x: PropertyInput): boolean =>
    x.decision.outcome !== "go" ||
    !["deny", "approval"].includes(readMandate(x.mandate, x.state, x.proposal)),
  "A2-item-terms": (x: PropertyInput): boolean => {
    if (x.decision.outcome !== "go") return true;
    const ids = x.proposal.parameters.evidence;
    return x.state.items
      .filter((i) => Array.isArray(ids) && ids.includes(i.id))
      .every((i) => readTerms(i.terms, i, x.state, x.proposal) !== "deny");
  },
  "A3-inbound-before-context": (x: PropertyInput): boolean =>
    x.state.items.every((i) =>
      // Readings and opaque content must still have an admitted carrier, tracked by the observer.
      x.state.admissionDigests.includes(i.digest),
    ),
  "A4-record-before-action": (x: PropertyInput): boolean =>
    !["go", "stop"].includes(x.decision.outcome) ||
    (x.record.beforeEffect &&
      (x.record.releases?.some(
        (r) => r.digest === digestOf(x.proposal) && r.outcome === x.decision.outcome,
      ) ||
        x.record.decisions.some(
          (d) =>
            d.actionDigest === digestOf(x.proposal) &&
            (x.decision.outcome === "go"
              ? d.outcome === "permit"
              : ["deny", "indeterminate"].includes(d.outcome)),
        ))),
  "A5-exact-approval": (x: PropertyInput): boolean => {
    const d = x.decision.authorisation;
    if (x.decision.outcome !== "go") return true;
    if (!d.approval) return d.basis !== "owner-approval";
    const digest = digestOf(x.proposal);
    return x.state.approvals[digest]?.id === d.approval && x.state.shownDigests.includes(digest);
  },
};
