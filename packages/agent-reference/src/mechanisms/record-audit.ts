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
import { type LedgerEntry, type LedgerHead, verifyLedgerAtHead } from "../store/ledger.js";
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
  readonly pruned?: boolean;
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

export async function auditReleases(
  entries: readonly LedgerEntry[],
  evaluate: ReleaseEvaluator,
  evidence: {
    readonly head: LedgerHead | undefined;
    readonly verifyApproval?: (
      entry: LedgerEntry,
      release: { readonly action: ActionIntent; readonly digest: string; readonly at: string },
    ) => Promise<boolean | undefined>;
  },
): Promise<RecordAudit> {
  const chain = verifyLedgerAtHead(entries, evidence.head);
  if (!chain.ok)
    return {
      chain: "broken",
      ...(chain.problem ? { problem: chain.problem } : {}),
      judged: [],
      unjudged: [],
      outside: [],
    };
  const approvals = new Map<string, LedgerEntry>();
  const spent = new Set<string>();
  const judged: AuditedRelease[] = [];
  const unjudged: (ChainPoint & { checks: string[] })[] = [];
  let pending: LedgerEntry | undefined;
  let message: LedgerEntry | undefined;
  let checks: string[] = [];
  for (const entry of entries) {
    const record = entry.record as Record<string, unknown>;
    if (record.producer === "core") continue;
    if (record.type === "approval" && typeof record.id === "string")
      approvals.set(record.id, entry);
    if (record.type === "approval-consumed" && typeof record.id === "string") spent.add(record.id);
    if (record.type === "authorisation-decision") pending = entry;
    if (record.type === "message-out") message = entry;
    if (record.type === "gate-check" && record.gate === "outbound-gate")
      checks.push(`${String(record.check)}:${String(record.verdict)}`);
    if (record.type !== "gate-decision" || record.gate !== "outbound-gate") continue;
    if (record.outcome === "go") {
      if (!pending) unjudged.push({ ...point(entry), checks });
      else {
        const id = pending.record.approval;
        const approval = typeof id === "string" && !spent.has(id) ? approvals.get(id) : undefined;
        judged.push(
          await judge(
            pending,
            entry,
            approval,
            typeof id === "string" && spent.has(id),
            evaluate,
            evidence.verifyApproval,
          ),
        );
        // A countersignature accepting terms for an accompanying, separately checked
        // disclosure does not spend the approval for carrying the approved data.
        const binding = message?.record.approvalBinding as
          | { intentDigest?: unknown; approval?: unknown }
          | undefined;
        const acceptance =
          message &&
          message.seq > pending.seq &&
          message.record.kind === "accept" &&
          (pending.record.action as ActionIntent).action === "distribute" &&
          binding?.intentDigest === pending.record.actionDigest &&
          binding?.approval === id;
        if (typeof id === "string" && !acceptance) spent.add(id);
      }
    }
    pending = undefined;
    message = undefined;
    checks = [];
  }
  return {
    chain: "intact",
    ...(chain.prunedThroughSeq ? { pruned: true } : {}),
    judged,
    unjudged,
    outside: judged.filter((release) => release.verdict !== "inside"),
  };
}

async function judge(
  decisionEntry: LedgerEntry,
  releaseEntry: LedgerEntry,
  approval: LedgerEntry | undefined,
  spent: boolean,
  evaluate: ReleaseEvaluator,
  verifyApproval: Parameters<typeof auditReleases>[2]["verifyApproval"],
): Promise<AuditedRelease> {
  const recorded = decisionEntry.record as unknown as AuthorisationDecision;
  const action = recorded.action;
  const digest = actionDigest(action);
  const mandate = { id: recorded.policy.id, digest: recorded.policy.digest };
  const base = {
    actionDigest: digest,
    action,
    mandate,
    at: releaseEntry.at,
    recorded: recorded.outcome,
    decision: point(decisionEntry),
    release: point(releaseEntry),
  };
  const indeterminate = {
    ...base,
    verdict: "indeterminate",
    reason: "record-unavailable",
  } as const;
  if (recorded.actionDigest !== digest || Date.parse(recorded.at) > Date.parse(releaseEntry.at))
    return indeterminate;
  const again = evaluate(action, releaseEntry.at, mandate);
  if (!again || again.outcome === "indeterminate") return indeterminate;
  let approved = false;
  if (again.outcome === "approval-required" && !spent && typeof recorded.approval === "string") {
    if (!approval) return indeterminate;
    const verified =
      approval.record.actionDigest === digest &&
      approval.record.decision === "approve" &&
      (await verifyApproval?.(approval, { action, digest, at: releaseEntry.at }));
    if (verified === undefined) return indeterminate;
    approved = verified;
  }
  const inside = again.outcome === "permit" || approved;
  return {
    ...base,
    recomputed: again.outcome,
    verdict: inside ? "inside" : "outside",
    reason: inside ? "within-mandate" : "not-authorised",
  };
}
