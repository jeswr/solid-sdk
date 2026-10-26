import { describe, expect, it } from "vitest";
import { effectiveCapability, sampleTriagePermission } from "./assess.js";
import { type Connection, DENY_ALL, type WorkflowPolicy } from "./model.js";

const POLICY: WorkflowPolicy = {
  source: "synthetic",
  lastUpdated: "2026-09-01",
  askWhenUncertain: [],
  defaultAllowed: ["classify", "draft", "read_via_approved_workflow"],
  requiresCurrentInstruction: [],
  requiresFreshExplicitInstruction: ["send_after_exact_draft_review"],
  taxonomy: {},
};

function account(restrictions: Partial<Connection["restrictions"]> = {}): Connection {
  return {
    id: "acct",
    label: "Synthetic account",
    channel: "email",
    provider: "gmail",
    organisation: "",
    identifiers: [],
    origin: "manual",
    evidence: [],
    conflicts: [],
    localConnector: { state: "setup-required" },
    restrictions: { ...DENY_ALL, ...restrictions },
    notes: "",
    updatedAt: "2026-09-26T00:00:00Z",
    updatedBy: "owner (dashboard)",
  };
}

const ALL = { agentEnabled: true, read: true, triage: true, draft: true, hostedTriage: true };

describe("effective capabilities (three separate layers)", () => {
  it("denies everything by default", () => {
    for (const cap of ["read", "triage", "draft", "send", "hostedTriage"] as const) {
      const e = effectiveCapability(account(), cap, {
        policy: POLICY,
        hostedEnabled: true,
        hostedKeyConfigured: true,
      });
      expect(e.allowed, cap).toBe(false);
      expect(e.owner.ok, cap).toBe(false);
    }
  });

  it("owner restrictions and policy never make up for a missing provider connection", () => {
    for (const cap of ["read", "triage", "draft"] as const) {
      const e = effectiveCapability(account(ALL), cap, {
        policy: POLICY,
        hostedEnabled: true,
        hostedKeyConfigured: true,
      });
      expect(e.owner.ok).toBe(true);
      expect(e.policy.ok).toBe(true);
      expect(e.provider.ok).toBe(false);
      expect(e.allowed).toBe(false);
    }
  });

  it("never allows sending", () => {
    const e = effectiveCapability(account(ALL), "send", {
      policy: POLICY,
      hostedEnabled: true,
      hostedKeyConfigured: true,
    });
    expect([e.allowed, e.owner.ok, e.policy.ok]).toEqual([false, false, false]);
  });

  it("hosted triage needs the key, the owner switch, read AND triage, per-account permission and policy", () => {
    const ctx = { policy: POLICY, hostedEnabled: true, hostedKeyConfigured: true };
    expect(effectiveCapability(account(ALL), "hostedTriage", ctx).allowed).toBe(true);
    expect(
      effectiveCapability(account({ ...ALL, triage: false }), "hostedTriage", ctx).allowed,
    ).toBe(false);
    expect(effectiveCapability(account({ ...ALL, read: false }), "hostedTriage", ctx).allowed).toBe(
      false,
    );
    expect(
      effectiveCapability(account({ ...ALL, hostedTriage: false }), "hostedTriage", ctx).allowed,
    ).toBe(false);
    expect(
      effectiveCapability(account({ ...ALL, agentEnabled: false }), "hostedTriage", ctx).allowed,
    ).toBe(false);
    expect(
      effectiveCapability(account(ALL), "hostedTriage", { ...ctx, hostedEnabled: false }).allowed,
    ).toBe(false);
    expect(
      effectiveCapability(account(ALL), "hostedTriage", { ...ctx, hostedKeyConfigured: false })
        .allowed,
    ).toBe(false);
    expect(
      effectiveCapability(account(ALL), "hostedTriage", { ...ctx, policy: null }).allowed,
    ).toBe(false);
  });

  it("sample triage follows the owner's restrictions and the policy", () => {
    expect(sampleTriagePermission(account(ALL), POLICY).allowed).toBe(true);
    expect(sampleTriagePermission(account({ ...ALL, triage: false }), POLICY).allowed).toBe(false);
    expect(sampleTriagePermission(account({ ...ALL, agentEnabled: false }), POLICY).allowed).toBe(
      false,
    );
    expect(sampleTriagePermission(account(ALL), null).allowed).toBe(false);
    expect(sampleTriagePermission(account(ALL), { ...POLICY, defaultAllowed: [] }).allowed).toBe(
      false,
    );
  });
});
