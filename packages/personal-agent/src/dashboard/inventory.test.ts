import { describe, expect, it } from "vitest";
import { capabilityMatrix, connectionStatus } from "./assess.js";
import { applySnapshot, parseSnapshot } from "./inventory.js";
import { emptySettings } from "./model.js";

// A SYNTHETIC snapshot in the registry export's shape (invented accounts, example.* domains).
const SNAPSHOT = {
  schemaVersion: 1,
  source: "synthetic registry export",
  observedAt: "2026-09-25T10:00:00Z",
  registryUpdated: "2026-09-20",
  accounts: [
    {
      id: "personal-gmail",
      channel: "email",
      provider: "gmail",
      label: "Personal Gmail",
      identifiers: { primary: "sam@example.com", aliases: ["s.sample@example.com"] },
      organization: "personal",
      connector: {
        target: "gmail_connector",
        setup_status: "connected",
        last_tested: "2026-09-18",
        last_test_result: "ok",
        available_in_mcp: true,
      },
    },
    {
      id: "work-mail",
      channel: "email",
      provider: "microsoft_365",
      label: "Work mail",
      identifiers: { primary: "sam@corp.example.org" },
      organization: "Example Corp",
      connector: { target: "graph_mail", setup_status: "planned" },
    },
    {
      // Same address as the work mailbox, different channel.
      id: "work-teams",
      channel: "microsoft_teams",
      provider: "microsoft_365",
      label: "Work Teams",
      identifiers: { primary: "sam@corp.example.org" },
      organization: "Example Corp",
      connector: { target: "graph_chat", setup_status: "not_configured" },
    },
    {
      id: "chat-handle",
      channel: "slack",
      provider: "to_confirm",
      label: "Team chat",
      identifiers: { primary: "to_record_privately", workspace: "example-team" },
      organization: "Example Corp",
      connector: { target: "slack_api", setup_status: "not_started" },
    },
    {
      id: "Bad_ID",
      channel: "email",
      provider: "gmail",
      label: "skipped",
      identifiers: {},
      organization: "",
      connector: { target: "x", setup_status: "x" },
    },
  ],
  communicationRules: {
    last_updated: "2026-09-01",
    decision_policy: { ask_when_uncertain_about: ["classification", "priority"] },
    capability_policy: {
      default_allowed: ["classify", "draft"],
      requires_current_instruction_or_narrow_active_authorization_rule: ["archive"],
      always_requires_fresh_explicit_instruction: ["send_after_exact_draft_review"],
    },
    triage_taxonomy: { urgent: "time-critical", noise: "ignorable" },
  },
  notes: [
    // Free text claiming verification: kept for display, never turned into evidence.
    "Codex Gmail connector verified on 2026-09-18 for s.sample@example.com and sam@corp.example.org.",
    "Profile address sam@example.com versus login sam.old@example.com contradict; unresolved.",
  ],
  evidence: [
    {
      channel: "email",
      provider: "gmail",
      identifier: "sam@example.com",
      method: "mailbox-profile-read",
      source: "synthetic historical check",
      observedOn: "2026-09-18",
    },
    {
      channel: "email",
      provider: "gmail",
      identifier: "SAM@corp.example.org",
      method: "mailbox-profile-read",
      source: "synthetic historical check",
      observedOn: "2026-09-18",
    },
    {
      // Near miss of sam.old / sam@: no account lists it exactly.
      channel: "email",
      provider: "gmail",
      identifier: "sam.0ld@example.com",
      method: "mailbox-profile-read",
      source: "synthetic historical check",
      observedOn: "2026-09-18",
    },
  ],
};

const imported = () => {
  const s = emptySettings("2026-09-26T00:00:00Z");
  const report = applySnapshot(s, parseSnapshot(SNAPSHOT), "2026-09-26T00:00:00Z");
  const byId = (id: string) => s.connections.find((c) => c.id === id);
  return { s, report, byId };
};

describe("inventory import", () => {
  it("imports records as inventory with deny-all restrictions and drops placeholders", () => {
    const { s, report, byId } = imported();
    expect(report).toEqual({
      imported: 4,
      updated: 0,
      skipped: ["Bad_ID"],
      evidenceForUnknownAddresses: 1,
    });
    expect(byId("chat-handle")?.identifiers).toEqual(["workspace: example-team"]);
    expect(byId("chat-handle")?.provider).toBe("not confirmed");
    expect(s.connections.every((c) => !c.restrictions.agentEnabled && !c.restrictions.read)).toBe(
      true,
    );
    expect(s.workflowPolicy?.defaultAllowed).toEqual(["classify", "draft"]);
  });

  it("attaches structured evidence only to the same channel with the exact identifier", () => {
    const { byId } = imported();
    expect(byId("personal-gmail")?.evidence).toMatchObject([
      { observedOn: "2026-09-18", identifier: "sam@example.com", method: "mailbox-profile-read" },
    ]);
    // Case-insensitive exact match on the work mailbox…
    expect(byId("work-mail")?.evidence).toHaveLength(1);
    // …but a Teams account with the same address is NOT evidence of a Teams connector.
    expect(byId("work-teams")?.evidence).toEqual([]);
    const now = new Date("2026-09-26T12:00:00Z");
    const teams = byId("work-teams");
    expect(teams ? connectionStatus(teams, now).state : undefined).toBe("inventory");
    expect(byId("work-mail")?.evidence[0]?.summary).toMatch(/nothing about other channels/);
  });

  it("free-text notes never become evidence", () => {
    const { byId } = imported();
    // The note names the alias s.sample@example.com; the account got evidence only from the
    // structured record for its primary address, not from the note.
    expect(byId("personal-gmail")?.evidence.map((e) => e.identifier)).toEqual(["sam@example.com"]);
    const withoutEvidence = { ...SNAPSHOT, evidence: undefined };
    const s = emptySettings("2026-09-26T00:00:00Z");
    applySnapshot(s, parseSnapshot(withoutEvidence), "2026-09-26T00:00:00Z");
    expect(s.connections.every((c) => c.evidence.length === 0)).toBe(true);
    expect(s.inventory?.notes).toEqual(SNAPSHOT.notes);
  });

  it("keeps an unmatched observation unattached and unresolved", () => {
    const { s } = imported();
    expect(s.inventory?.unmatchedEvidence).toEqual([
      {
        channel: "email",
        provider: "gmail",
        identifier: "sam.0ld@example.com",
        method: "mailbox-profile-read",
        observedOn: "2026-09-18",
      },
    ]);
    expect(
      s.connections.some((c) => c.evidence.some((e) => e.identifier === "sam.0ld@example.com")),
    ).toBe(false);
  });

  it("records a provider mismatch as an unresolved conflict", () => {
    const { byId } = imported();
    expect(byId("work-mail")?.conflicts).toEqual([
      "The inventory records the provider as “microsoft 365”, but this address was observed through a gmail connector on 2026-09-18. Unresolved.",
    ]);
    expect(byId("personal-gmail")?.conflicts).toEqual([SNAPSHOT.notes[1]]);
    expect(byId("work-teams")?.conflicts).toEqual([]);
  });

  it("never reports an active connection, and nothing is permitted", () => {
    const { s, byId } = imported();
    const now = new Date("2026-09-26T12:00:00Z");
    const gmail = byId("personal-gmail");
    const status = gmail ? connectionStatus(gmail, now) : undefined;
    expect(status?.state).toBe("previously-codex");
    expect(status?.stale).toBe(true); // 8 days old
    for (const c of s.connections)
      expect(["active-provider", "local-connector"]).not.toContain(connectionStatus(c, now).state);
    for (const row of capabilityMatrix(s, true))
      for (const cap of row.capabilities) expect(cap.allowed).toBe(false);
  });

  it("keeps the owner's restrictions, notes and connector route on re-import, and drops stale evidence", () => {
    const { s } = imported();
    const c = s.connections.find((x) => x.id === "work-mail");
    if (!c) throw new Error("missing");
    c.restrictions = { ...c.restrictions, agentEnabled: true, read: true };
    c.notes = "owner note";
    c.localConnector = { state: "setup-required", target: "graph adapter" };
    const report = applySnapshot(
      s,
      parseSnapshot({ ...SNAPSHOT, evidence: [] }),
      "2026-09-27T00:00:00Z",
    );
    expect(report.updated).toBe(4);
    const again = s.connections.find((x) => x.id === "work-mail");
    expect(again?.restrictions.read).toBe(true);
    expect(again?.notes).toBe("owner note");
    expect(again?.localConnector.target).toBe("graph adapter");
    expect(again?.evidence).toEqual([]);
    expect(s.connections).toHaveLength(4);
  });

  it("refuses oversized or malformed snapshots", () => {
    expect(() => parseSnapshot({ ...SNAPSHOT, schemaVersion: 2 })).toThrow();
    expect(() =>
      parseSnapshot({
        ...SNAPSHOT,
        accounts: Array.from({ length: 201 }, () => SNAPSHOT.accounts[0]),
      }),
    ).toThrow();
    expect(() => parseSnapshot({ ...SNAPSHOT, notes: ["x".repeat(501)] })).toThrow();
    expect(() =>
      parseSnapshot({
        ...SNAPSHOT,
        evidence: [{ ...SNAPSHOT.evidence[0], observedOn: "yesterday" }],
      }),
    ).toThrow();
  });
});
