/**
 * Read-only summaries of the managed personal agents for the owner's dashboard: identity, the
 * owner mandate AS STORED (decoded for display, not re-verified here), policy-module status,
 * applied availability, synthetic holds and a decision summary from the evidence ledger.
 * Never read: private keys, owner keys, raw messages, trust material, tokens or peer endpoints.
 * Nothing is written.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AVAILABILITY_FILE, readAvailabilityOverlay } from "../pilot/availability.js";
import { FileLedger, verifyLedger } from "../pilot/store/ledger.js";
import { agentStartedAt, readAgentCalendar } from "./calendars.js";

interface Rule {
  action?: string;
  target?: string;
  constraints?: { leftOperand?: string; rightOperand?: unknown }[];
}

function shortIri(v: string): string {
  const hash = v.lastIndexOf("#");
  const slash = v.lastIndexOf("/");
  return v.slice(Math.max(hash, slash) + 1) || v;
}

function rules(policy: { permissions?: Rule[] } | undefined) {
  return (policy?.permissions ?? []).slice(0, 20).map((r) => {
    const values = (op: string) =>
      (r.constraints ?? [])
        .filter((c) => c.leftOperand === op)
        .flatMap((c) => (Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand]))
        .map((x) => shortIri(String(x)))
        .slice(0, 10);
    return {
      action: String(r.action ?? ""),
      target: shortIri(String(r.target ?? "")),
      purposes: values("purpose"),
      recipients: values("recipient"),
    };
  });
}

function decodeJws(jws: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export interface AgentSummary {
  name: string;
  found: boolean;
  running: boolean;
  role?: string;
  party?: string;
  actor?: string;
  timeZone?: string;
  /** Why the agent's own calendar data cannot be used (missing or unreadable), if so. */
  calendarProblem?: string;
  mandate?: {
    validFrom?: string;
    validUntil?: string;
    autonomous: ReturnType<typeof rules>;
    withApproval: ReturnType<typeof rules>;
    note: string;
  };
  policyModule?: { engine?: string; evaluator?: string; recordedAt?: string };
  availability: {
    applied: boolean;
    revision?: number;
    blocked?: string;
    /**
     * Whether the RUNNING agent uses the applied file. The agent reads it only at start, so this
     * is inferred from times: it started after the file was written ("in-use"), before it
     * ("pending-restart"), or it is not running ("next-start").
     */
    use?: "in-use" | "pending-restart" | "next-start" | "unknown";
  };
  holds: { start: string; end: string; title: string }[];
  evidence?: {
    verified: boolean;
    entries: number;
    decisions: Record<string, number>;
    recent: { at: string; outcome: string; action: string; operation: string }[];
  };
}

export function summariseAgent(agentsDir: string, name: string): AgentSummary {
  const dir = join(agentsDir, name);
  const read = (f: string) =>
    existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : undefined;
  const identityText = read("identity.json");
  if (!identityText)
    return { name, found: false, running: false, availability: { applied: false }, holds: [] };
  const identity = JSON.parse(identityText) as Record<string, unknown>;
  const mandate = decodeJws(read("mandate.jws")?.trim() ?? "") as
    | {
        validFrom?: string;
        validUntil?: string;
        autonomous?: { permissions?: Rule[] };
        withApproval?: { permissions?: Rule[] };
      }
    | undefined;
  const policy = read("policy-engine.json")
    ? (JSON.parse(read("policy-engine.json") as string) as Record<string, unknown>)
    : undefined;
  // Same validated reader as the calendar page: unreadable data is reported, not a page failure.
  const calendarRead = readAgentCalendar(agentsDir, name);
  const calendar = "data" in calendarRead ? calendarRead.data : undefined;
  const overlay = readAvailabilityOverlay(dir);
  const started = agentStartedAt(dir);
  const running = started !== undefined;
  let use: NonNullable<AgentSummary["availability"]["use"]> = "next-start";
  if (overlay && running) {
    const written = statSync(join(dir, AVAILABILITY_FILE)).mtimeMs;
    use = started === null ? "unknown" : started >= written ? "in-use" : "pending-restart";
  }
  const summary: AgentSummary = {
    name,
    found: true,
    running,
    role: String(identity.role ?? "personal"),
    party: String(identity.party ?? ""),
    actor: String(identity.actor ?? ""),
    timeZone: String(identity.timeZone ?? "UTC"),
    ...(mandate
      ? {
          mandate: {
            ...(mandate.validFrom ? { validFrom: mandate.validFrom } : {}),
            ...(mandate.validUntil ? { validUntil: mandate.validUntil } : {}),
            autonomous: rules(mandate.autonomous),
            withApproval: rules(mandate.withApproval),
            note: "A stored statement, shown as recorded in the agent's directory. This page does not verify it; the agent verifies its mandate when it runs.",
          },
        }
      : {}),
    ...(policy
      ? {
          policyModule: {
            engine: String(policy.engine ?? ""),
            evaluator: String(policy.evaluator ?? ""),
            recordedAt: String(policy.recordedAt ?? ""),
          },
        }
      : {}),
    availability: overlay
      ? {
          applied: true,
          revision: overlay.revision,
          ...(overlay.blocked ? { blocked: overlay.blocked.reason } : {}),
          use,
        }
      : { applied: false },
    ...("problem" in calendarRead ? { calendarProblem: calendarRead.problem } : {}),
    holds: Object.values(calendar?.holds ?? {})
      .slice(0, 50)
      .map((h) => ({ start: h.start, end: h.end, title: String(h.title).slice(0, 120) })),
  };
  if (existsSync(join(dir, "ledger.jsonl"))) {
    const entries = new FileLedger(join(dir, "ledger.jsonl")).entries();
    const decisions: Record<string, number> = {};
    const recent: NonNullable<AgentSummary["evidence"]>["recent"] = [];
    for (const e of entries) {
      const r = e.record as Record<string, unknown>;
      if (r.type !== "authorisation-decision") continue;
      const outcome = String(r.outcome ?? "unknown");
      decisions[outcome] = (decisions[outcome] ?? 0) + 1;
      const action = (r.action ?? {}) as { action?: string; operation?: string };
      recent.push({
        at: e.at,
        outcome,
        action: String(action.action ?? ""),
        operation: shortIri(String(action.operation ?? "")),
      });
    }
    summary.evidence = {
      verified: verifyLedger(entries).ok,
      entries: entries.length,
      decisions,
      recent: recent.slice(-10).reverse(),
    };
  }
  return summary;
}
