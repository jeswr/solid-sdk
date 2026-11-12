// AUTHORED-BY Codex GPT-6.1-Sol
import type { ActionProposal } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { describe, expect, it } from "vitest";
import { canBulkApprove, conservativeReason, pendingApprovals } from "../src/apps/agent/lib/queue";
import type { DisplayApproval, DisplayControl } from "../src/apps/agent/lib/readers";
import { agentStatus } from "../src/apps/agent/lib/status";

const now = Date.parse("2026-11-01T12:00:00Z");
const at = (offset: number) => new Date(now + offset).toISOString();
const control = (
  kind: DisplayControl["kind"],
  created: number,
  expires = 60000,
): DisplayControl => ({
  ...exampleRecords["control-statement"],
  verification: "verified",
  kind,
  createdAt: at(created),
  expires: at(expires),
});
describe("agent verified status table", () => {
  it.each([
    { heartbeatAt: undefined, controls: [], state: "offline" },
    { heartbeatAt: at(-120001), controls: [], state: "offline" },
    { heartbeatAt: "invalid", controls: [], state: "offline" },
    { heartbeatAt: at(1), controls: [], state: "offline" },
    { heartbeatAt: at(-120000), controls: [], state: "running" },
    { heartbeatAt: at(-30000), controls: [], state: "running" },
    { heartbeatAt: at(-30000), heartbeatState: "paused" as const, controls: [], state: "paused" },
    { heartbeatAt: at(-30000), heartbeatState: "stopped" as const, controls: [], state: "stopped" },
    {
      heartbeatAt: at(-120001),
      heartbeatState: "stopped" as const,
      controls: [],
      state: "offline",
    },
    {
      heartbeatAt: at(-30000),
      heartbeatState: "running" as const,
      controls: [control("Halt", -1)],
      state: "stopped",
    },
    { heartbeatAt: undefined, controls: [control("Halt", -1)], state: "stopped" },
    {
      heartbeatAt: at(-30000),
      controls: [control("Resume", -2), control("Halt", -1)],
      state: "stopped",
    },
    {
      heartbeatAt: at(-30000),
      controls: [control("Halt", -2), control("Resume", -1)],
      state: "running",
    },
    { heartbeatAt: at(-30000), controls: [control("Halt", -2, -1)], state: "running" },
    {
      heartbeatAt: at(-30000),
      controls: [control("Halt", 2), control("SetBindingState", -1)],
      state: "running",
    },
    {
      heartbeatAt: at(-30000),
      controls: [{ ...control("Halt", -1), verification: "unchecked" as const }],
      state: "running",
    },
    {
      heartbeatAt: at(-30000),
      controls: [{ ...control("Halt", -1), verification: { invalid: "signature" } }],
      state: "running",
    },
    {
      heartbeatAt: at(-30000),
      controls: [
        control("Halt", -1),
        { ...control("Resume", 0), verification: "unchecked" as const },
      ],
      state: "stopped",
    },
    {
      heartbeatAt: at(-30000),
      controls: [control("Halt", -1), control("Resume", -1)],
      state: "stopped",
    },
    {
      heartbeatAt: at(-30000),
      controls: [control("Resume", -1), control("Halt", -1)],
      state: "stopped",
    },
  ])("$state for $heartbeatAt and $controls", ({ state, ...input }) =>
    expect(agentStatus({ ...input, now }).state).toBe(state));
  it("keeps loading unknown, last seen and owner binding", () => {
    expect(agentStatus({ now, controls: [], loading: true })).toEqual({ state: "unknown" });
    expect(
      agentStatus({
        now,
        heartbeatAt: at(-1),
        controls: [control("Halt", -2)],
        owner: "https://different.example/#me",
      }),
    ).toEqual({ state: "running", lastSeen: at(-1) });
    expect(
      agentStatus({
        now,
        heartbeatAt: at(-1),
        controls: [control("Halt", -2)],
        owner: exampleRecords["control-statement"].attributedTo,
      }).state,
    ).toBe("stopped");
  });
  it("uses only the newest verified owner control to select Resume, independently of heartbeat state", () => {
    const input = {
      now,
      heartbeatAt: at(-1),
      heartbeatState: "stopped" as const,
      owner: exampleRecords["control-statement"].attributedTo,
    };
    for (const controls of [
      [],
      [{ ...control("Halt", -1), verification: "unchecked" as const }],
      [{ ...control("Halt", -1), attributedTo: "urn:another-owner" }],
      [control("Halt", -3), control("Resume", -2)],
    ]) {
      const status = agentStatus({ ...input, controls });
      expect(status.state).toBe("stopped");
      expect(status.ownerHalted).not.toBe(true);
    }
    expect(
      agentStatus({ ...input, controls: [control("Resume", -3), control("Halt", -2)] }),
    ).toMatchObject({ state: "stopped", ownerHalted: true });
  });
});
const proposal: ActionProposal = {
  ...exampleRecords["action-proposal"],
  createdAt: at(-1000),
  validUntil: at(60000),
};
const approval = (decision: DisplayApproval["decision"] = "approve"): DisplayApproval => ({
  ...exampleRecords.approval,
  decision,
  verification: "verified",
  approves: proposal.id,
  termsDigest: proposal.intent.termsDigest,
  createdAt: at(-500),
  expires: at(30000),
});
describe("approval queue", () => {
  it.each([
    "approved",
    "denied",
    "expired",
    "sent",
    "failed",
  ] as const)("excludes daemon %s proposals", (state) =>
    expect(pendingApprovals([{ ...proposal, state }], [], [], now)).toEqual([]));
  it("includes pending terms with friendly reason and lifetime", () => {
    expect(pendingApprovals([proposal], [], [], now)).toEqual([
      {
        proposal,
        reason: "Ask first",
        state: "pending",
        verification: "unchecked",
        expiresIn: 60000,
        approvedAwaitingSend: false,
        needsNewApproval: false,
      },
    ]);
    expect(pendingApprovals([{ ...proposal, validUntil: at(0) }], [], [], now)).toEqual([]);
    expect(
      pendingApprovals(
        [{ ...proposal, intent: { ...proposal.intent, parameters: { prohibited: true } } }],
        [],
        [],
        now,
      )[0]?.reason,
    ).toBe("Never");
  });
  it("settles only verified decisions and re-queues changed terms", () => {
    expect(pendingApprovals([proposal], [approval()], [], now)[0]).toMatchObject({
      state: "approved",
      approvedAwaitingSend: true,
      verification: "verified",
    });
    expect(pendingApprovals([proposal], [approval("deny")], [], now)[0]?.state).toBe("denied");
    expect(
      pendingApprovals([proposal], [{ ...approval(), termsDigest: "sha-256:old" }], [], now)[0],
    ).toMatchObject({ needsNewApproval: true, reason: "Needs a new approval", state: "pending" });
    for (const invalid of [
      { ...approval(), expires: at(0) },
      { ...approval(), createdAt: at(1) },
      { ...approval(), approves: "urn:other" },
      { ...approval(), verification: "unchecked" as const },
      { ...approval(), verification: { invalid: "key" } },
    ])
      expect(pendingApprovals([proposal], [invalid], [], now)[0]?.approvedAwaitingSend).toBe(false);
    // A denial from an unchecked document or another owner's key has no effect.
    for (const verification of ["unchecked", { invalid: "key" }, { invalid: "signature" }] as const)
      expect(
        pendingApprovals([proposal], [{ ...approval("deny"), verification }], [], now)[0]?.state,
      ).toBe("pending");
    for (const decisions of [
      [approval(), { ...approval("deny"), createdAt: at(-1) }],
      [{ ...approval("deny"), createdAt: at(-1) }, approval()],
      [approval(), approval("deny")],
      [approval("deny"), approval()],
    ])
      expect(pendingApprovals([proposal], decisions, [], now)[0]?.state).toBe("denied");
  });
  it("recognizes sent for this approval, keeps changed or incomplete transmissions and sorts", () => {
    const tx = {
      ...exampleRecords.transmission,
      proposal: proposal.id,
      underApproval: approval().id,
    };
    expect(
      pendingApprovals([proposal], [approval()], [{ ...tx, status: "sent" }], now)[0]?.state,
    ).toBe("sent");
    expect(pendingApprovals([proposal], [], [{ ...tx, status: "sent" }], now)[0]?.state).toBe(
      "pending",
    );
    expect(
      pendingApprovals(
        [proposal],
        [approval()],
        [{ ...tx, underApproval: "urn:old", status: "sent" }],
        now,
      )[0]?.state,
    ).toBe("approved");
    expect(
      pendingApprovals([proposal], [], [tx, { ...tx, proposal: "urn:other", status: "sent" }], now),
    ).toHaveLength(1);
    const newer = { ...proposal, id: "urn:newer", createdAt: at(-1) };
    expect(pendingApprovals([proposal, newer], [], [], now).map((row) => row.proposal.id)).toEqual([
      newer.id,
      proposal.id,
    ]);
  });
  it.each([
    "approve",
    "deny",
  ] as const)("keeps proposals pending for incomplete evidence despite a verified %s and a sent record", (decision) => {
    const current = approval(decision);
    expect(
      pendingApprovals(
        [proposal],
        [current],
        [
          {
            ...exampleRecords.transmission,
            proposal: proposal.id,
            underApproval: current.id,
            status: "sent",
          },
        ],
        now,
        false,
      )[0],
    ).toMatchObject({ state: "pending", approvedAwaitingSend: false, verification: "unchecked" });
  });
  it("bulk requires pending identical kinds and recipients and no prohibition", () => {
    const row = pendingApprovals([proposal], [], [], now)[0];
    if (!row) throw new Error("Missing fixture");
    expect(canBulkApprove([])).toBe(false);
    expect(canBulkApprove([row, row])).toBe(true);
    for (const changed of [
      { ...row, state: "denied" as const },
      { ...row, reason: "Never" },
      { ...row, proposal: { ...proposal, intent: { ...proposal.intent, action: "remember" } } },
      {
        ...row,
        proposal: { ...proposal, intent: { ...proposal.intent, recipientHash: "different" } },
      },
    ])
      expect(canBulkApprove([row, changed])).toBe(false);
  });
});

it.each([
  ["Allowed", "Ask first", "Ask first"],
  ["Ask first", "Allowed", "Ask first"],
  ["Never", "Ask first", "Never"],
  ["Ask first", "Never", "Never"],
  ["Needs a new approval", "Ask first", "Needs a new approval"],
  ["Needs a new approval", "Never", "Never"],
  ["Allowed", "Something new", "Something new"],
  ["Something new", "Allowed", "Something new"],
])("keeps the more restrictive badge of %s and %s", (a, b, want) =>
  expect(conservativeReason(a, b)).toBe(want));
