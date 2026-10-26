/**
 * Plain-language assessment of connection status and effective capabilities.
 *
 * Status is derived, never stored, and never "connected" on the strength of an inventory or of
 * another tool's historic connector check. Capabilities are computed from three SEPARATE layers
 * — provider evidence, owner restrictions, workflow policy — and an action is allowed only if all
 * three allow it. Anything not explicitly allowed is denied. Being connected is not permission.
 */
import type { Connection, Settings, WorkflowPolicy } from "./model.js";

const DAY = 86_400_000;
const STALE_AFTER_DAYS = 7;

export type ConnectionState =
  | "active-provider"
  | "local-connector"
  | "previously-codex"
  | "inventory"
  | "setup-required"
  | "unknown";

/** Every state the UI explains (the first two cannot be reached in this phase; see note). */
export const CONNECTION_STATES: Record<ConnectionState, { title: string; meaning: string }> = {
  "active-provider": {
    title: "Active connection",
    meaning:
      "This agent holds its own provider access and has verified it recently. No account is in this state yet: no provider connection has been set up for this agent.",
  },
  "local-connector": {
    title: "Local connector configured",
    meaning:
      "A connector for this agent is configured on this machine but not yet verified against the provider. No account is in this state yet.",
  },
  "previously-codex": {
    title: "Previously checked through Codex",
    meaning:
      "Another tool (a Codex connector) could reach this account on the date shown. That access belongs to that tool; this agent cannot use it, and it says nothing about today.",
  },
  inventory: {
    title: "Known from inventory",
    meaning:
      "Listed in your imported account inventory. The inventory records accounts and intended connectors; it is not a connection.",
  },
  "setup-required": {
    title: "Setup required",
    meaning:
      "You added this record here. It needs a provider connection before the agent can use it.",
  },
  unknown: {
    title: "Status unknown",
    meaning: "There is no evidence about this account.",
  },
};

export interface ConnectionStatus {
  state: ConnectionState;
  title: string;
  explanation: string;
  /** Where the status comes from, in plain words. */
  source: string;
  lastObserved: string | null;
  stale: boolean;
  /** What exists in THIS agent for this kind of account. */
  adapter: string;
}

function humanise(v: string): string {
  return v.replaceAll("_", " ");
}

export function adapterAvailability(c: Pick<Connection, "channel" | "provider">): string {
  if (c.channel === "email")
    return "An email adapter exists in this agent, but it needs a provider connection supplied for a supervised run. Nothing is connected.";
  if (c.channel === "calendar")
    return "This agent works with synthetic calendars only. There is no provider calendar adapter yet.";
  return "This agent has no adapter for this kind of account yet.";
}

export function connectionStatus(c: Connection, now: Date): ConnectionStatus {
  const adapter = adapterAvailability(c);
  const ageDays = (d: string) => (now.getTime() - Date.parse(d)) / DAY;
  if (c.evidence.length > 0) {
    const last = c.evidence
      .map((e) => e.observedOn)
      .sort()
      .at(-1) as string;
    return {
      state: "previously-codex",
      title: CONNECTION_STATES["previously-codex"].title,
      explanation: `Checked through a Codex connector on ${last}. ${CONNECTION_STATES["previously-codex"].meaning}`,
      source: "Historic evidence recorded in your inventory notes",
      lastObserved: last,
      stale: ageDays(last) > STALE_AFTER_DAYS,
      adapter,
    };
  }
  if (c.origin !== "inventory" && c.localConnector.state === "setup-required") {
    return {
      state: "setup-required",
      title: CONNECTION_STATES["setup-required"].title,
      explanation: CONNECTION_STATES["setup-required"].meaning,
      source:
        c.origin === "demo" ? "Synthetic demonstration record" : "Added by you in this dashboard",
      lastObserved: null,
      stale: false,
      adapter,
    };
  }
  if (c.inventory) {
    const inv = c.inventory;
    const tested = inv.lastTested
      ? ` It was last tested on ${inv.lastTested} (${humanise(inv.lastTestResult ?? "result not recorded")}) by that connector, not by this agent.`
      : "";
    return {
      state: "inventory",
      title: CONNECTION_STATES.inventory.title,
      explanation: `The inventory records the intended connector as “${humanise(inv.connectorTarget)}” with status “${humanise(inv.setupStatus)}”.${tested} ${CONNECTION_STATES.inventory.meaning}`,
      source: `Inventory snapshot taken ${inv.observedAt.slice(0, 10)} (registry updated ${inv.registryUpdated})`,
      lastObserved: inv.lastTested ?? inv.observedAt.slice(0, 10),
      stale: ageDays(inv.lastTested ?? inv.observedAt) > STALE_AFTER_DAYS,
      adapter,
    };
  }
  return {
    state: "unknown",
    title: CONNECTION_STATES.unknown.title,
    explanation: CONNECTION_STATES.unknown.meaning,
    source: "No evidence",
    lastObserved: null,
    stale: true,
    adapter,
  };
}

// ------------------------------------------------------------------ capabilities

export type Capability = "read" | "triage" | "draft" | "send" | "hostedTriage";
export const CAPABILITIES: Record<Capability, string> = {
  read: "Read messages",
  triage: "Suggest triage",
  draft: "Draft replies (future)",
  send: "Send",
  hostedTriage: "Share samples with hosted triage",
};

export interface Layer {
  ok: boolean;
  why: string;
}
export interface Effective {
  capability: Capability;
  label: string;
  allowed: boolean;
  summary: string;
  provider: Layer;
  owner: Layer;
  policy: Layer;
}

/** Owner and policy decisions for one capability (provider evidence supplied separately). */
export function effectiveCapability(
  c: Connection,
  cap: Capability,
  ctx: { policy: WorkflowPolicy | null; hostedEnabled: boolean; hostedKeyConfigured: boolean },
): Effective {
  const r = c.restrictions;
  const status = connectionStatus(c, new Date());
  const noProvider: Layer = {
    ok: false,
    why:
      status.state === "previously-codex"
        ? "Only another tool (Codex) has reached this account; this agent has no provider connection."
        : "This agent has no provider connection for this account.",
  };
  let provider: Layer;
  let owner: Layer;
  let policy: Layer;
  const p = ctx.policy;
  const policyAllows = (name: string, label: string): Layer =>
    !p
      ? { ok: false, why: "No communication policy has been imported, so nothing is allowed." }
      : p.defaultAllowed.includes(name)
        ? { ok: true, why: `Your policy allows “${label}” through an approved workflow.` }
        : { ok: false, why: `Your policy does not list “${label}” as allowed by default.` };
  const ownerAllows = (flag: boolean, label: string): Layer =>
    !r.agentEnabled
      ? { ok: false, why: "You have excluded this account from the agent." }
      : flag
        ? { ok: true, why: `You allow the agent to ${label}.` }
        : { ok: false, why: `You have not allowed the agent to ${label}.` };
  switch (cap) {
    case "read":
      provider = noProvider;
      owner = ownerAllows(r.read, "read messages");
      policy = policyAllows("read_via_approved_workflow", "read via approved workflow");
      break;
    case "triage":
      provider = noProvider;
      owner = ownerAllows(r.read && r.triage, "read and suggest triage");
      policy = policyAllows("classify", "classify");
      break;
    case "draft":
      provider = noProvider;
      owner = ownerAllows(
        r.draft,
        "draft replies (recorded for later: this version has no drafting)",
      );
      policy = policyAllows("draft", "draft");
      break;
    case "send":
      provider = noProvider;
      owner = {
        ok: false,
        why: "Sending cannot be enabled from this dashboard. Every outgoing message needs your review of the exact draft.",
      };
      policy = {
        ok: false,
        why: p?.requiresFreshExplicitInstruction.includes("send_after_exact_draft_review")
          ? "Your policy requires a fresh, explicit instruction after you review the exact draft."
          : "Sending is not allowed.",
      };
      break;
    case "hostedTriage":
      provider = ctx.hostedKeyConfigured
        ? { ok: true, why: "A TypeSafe key is configured on this machine." }
        : { ok: false, why: "No TypeSafe key is configured on this machine." };
      // Consent to hosted triage never overrides "triage off": reading and triage must be allowed.
      owner = !r.agentEnabled
        ? { ok: false, why: "You have excluded this account from the agent." }
        : !(r.read && r.triage)
          ? { ok: false, why: "Reading and triage are not both allowed for this account." }
          : !ctx.hostedEnabled
            ? { ok: false, why: "Hosted triage is turned off." }
            : r.hostedTriage
              ? { ok: true, why: "You allow samples for this account to be sent to TypeSafe." }
              : {
                  ok: false,
                  why: "You have not allowed samples for this account to be sent to TypeSafe.",
                };
      policy = policyAllows("classify", "classify");
      break;
  }
  const allowed = provider.ok && owner.ok && policy.ok;
  const failing = [provider, owner, policy].find((l) => !l.ok);
  return {
    capability: cap,
    label: CAPABILITIES[cap],
    allowed,
    summary: allowed ? "Allowed" : (failing?.why ?? "Not allowed"),
    provider,
    owner,
    policy,
  };
}

/**
 * Triage of a SAMPLE the owner supplies for an account (no provider is involved: the text comes
 * from the owner). The owner's restrictions (included, read AND triage) and the workflow policy
 * (classify) decide, for the local rules and — together with the hosted conditions — for hosted
 * triage. A sample linked to no account is a separate synthetic sandbox.
 */
export function sampleTriagePermission(
  c: Connection,
  policy: WorkflowPolicy | null,
): { allowed: boolean; why: string } {
  const r = c.restrictions;
  if (!r.agentEnabled)
    return { allowed: false, why: "You have excluded this account from the agent." };
  if (!(r.read && r.triage))
    return { allowed: false, why: "Reading and triage are not both allowed for this account." };
  if (!policy)
    return {
      allowed: false,
      why: "No communication policy has been imported, so nothing is allowed.",
    };
  if (!policy.defaultAllowed.includes("classify"))
    return { allowed: false, why: "Your policy does not list “classify” as allowed by default." };
  return {
    allowed: true,
    why: "You allow triage for this account and your policy allows classifying.",
  };
}

export function capabilityMatrix(
  s: Settings,
  hostedKeyConfigured: boolean,
): { id: string; label: string; capabilities: Effective[] }[] {
  return s.connections.map((c) => ({
    id: c.id,
    label: c.label,
    capabilities: (Object.keys(CAPABILITIES) as Capability[]).map((cap) =>
      effectiveCapability(c, cap, {
        policy: s.workflowPolicy,
        hostedEnabled: s.triage.hostedEnabled,
        hostedKeyConfigured,
      }),
    ),
  }));
}
