// AUTHORED-BY Claude Opus 5.5
/**
 * Brief 32 §3: the record audit. It reads an agent's own hash-chained record and judges
 * every action the outbound gate released against the mandate in force when it was
 * released. It never trusts the recorded outcome and never reads a stand-in marker: each
 * release is re-evaluated at its recorded time, against the mandate whose digest the
 * recorded decision names.
 *
 * - A released action is a `gate-decision` entry from the outbound gate with outcome `go`.
 *   Its action is the last `authorisation-decision` recorded since the previous outbound
 *   `gate-decision`. A `go` with no such entry (a reply inside an agreed exchange) is
 *   `unjudged`: reported, not judged.
 * - Inside: the recomputed outcome is `permit`, or it is `approval-required` and the
 *   recorded decision names an approval, recorded in the same chain, for that exact action
 *   digest. Outside: anything else.
 * - Indeterminate (`record-unavailable`): the mandate digest the decision names is not held.
 */
import type { ActionIntent, AuthorisationDecision } from "../core/types.js";
import { type LedgerEntry, verifyLedger } from "../store/ledger.js";
import { actionDigest } from "./mandate.js";

export interface ChainPoint {
  readonly seq: number;
  readonly hash: string;
}

export interface AuditedRelease {
  readonly actionDigest: string;
  readonly action: ActionIntent;
  readonly mandate: { readonly id: string; readonly digest: string };
  readonly at: string;
  readonly recorded: string;
  readonly recomputed?: string;
  readonly verdict: "inside" | "outside" | "indeterminate";
  readonly reason: "within-mandate" | "not-authorised" | "record-unavailable";
  /** The authorisation-decision entry and the outbound release entry. */
  readonly decision: ChainPoint;
  readonly release: ChainPoint;
}

export interface RecordAudit {
  readonly chain: "intact" | "broken";
  readonly problem?: string;
  readonly judged: readonly AuditedRelease[];
  readonly unjudged: readonly (ChainPoint & { readonly checks: readonly string[] })[];
  readonly outside: readonly AuditedRelease[];
}

/**
 * Re-evaluates one recorded action at its recorded time against the named mandate; returns
 * undefined when that mandate digest is not held.
 */
export type ReleaseEvaluator = (
  action: ActionIntent,
  at: string,
  mandate: { readonly id: string; readonly digest: string },
) => AuthorisationDecision | undefined;

const point = (entry: LedgerEntry): ChainPoint => ({ seq: entry.seq, hash: entry.hash });

export function auditReleases(
  entries: readonly LedgerEntry[],
  evaluate: ReleaseEvaluator,
): RecordAudit {
  const chain = verifyLedger(entries);
  if (!chain.ok)
    return {
      chain: "broken",
      ...(chain.problem ? { problem: chain.problem } : {}),
      judged: [],
      unjudged: [],
      outside: [],
    };
  const approvals = new Map<string, string>();
  const judged: AuditedRelease[] = [];
  const unjudged: (ChainPoint & { checks: string[] })[] = [];
  let pending: LedgerEntry | undefined;
  let checks: string[] = [];
  for (const entry of entries) {
    const record = entry.record as Record<string, unknown>;
    if (record.type === "approval" && record.decision === "approve")
      approvals.set(String(record.id), String(record.actionDigest));
    if (record.type === "authorisation-decision") pending = entry;
    if (record.type === "gate-check" && record.gate === "outbound-gate")
      checks.push(`${String(record.check)}:${String(record.verdict)}`);
    if (record.type !== "gate-decision" || record.gate !== "outbound-gate") continue;
    if (record.outcome === "go") {
      if (!pending) unjudged.push({ ...point(entry), checks });
      else judged.push(judge(pending, entry, approvals, evaluate));
    }
    pending = undefined;
    checks = [];
  }
  return {
    chain: "intact",
    judged,
    unjudged,
    outside: judged.filter((release) => release.verdict !== "inside"),
  };
}

function judge(
  decisionEntry: LedgerEntry,
  releaseEntry: LedgerEntry,
  approvals: ReadonlyMap<string, string>,
  evaluate: ReleaseEvaluator,
): AuditedRelease {
  const recorded = decisionEntry.record as unknown as AuthorisationDecision;
  const action = recorded.action;
  const digest = actionDigest(action);
  const mandate = { id: recorded.policy.id, digest: recorded.policy.digest };
  const base = {
    actionDigest: digest,
    action,
    mandate,
    at: recorded.at,
    recorded: recorded.outcome,
    decision: point(decisionEntry),
    release: point(releaseEntry),
  };
  const again = evaluate(action, recorded.at, mandate);
  if (!again) return { ...base, verdict: "indeterminate", reason: "record-unavailable" } as const;
  const approved =
    again.outcome === "approval-required" &&
    typeof recorded.approval === "string" &&
    approvals.get(recorded.approval) === digest;
  const inside = again.outcome === "permit" || approved;
  return {
    ...base,
    recomputed: again.outcome,
    verdict: inside ? "inside" : "outside",
    reason: inside ? "within-mandate" : "not-authorised",
  };
}
