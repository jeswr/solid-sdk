// AUTHORED-BY Codex GPT-6.1-Sol

import type { ActionProposal, Approval, ControlStatement } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { describe, expect, it } from "vitest";
import { pendingApprovals } from "../src/apps/agent/lib/queue";
import { agentStatus } from "../src/apps/agent/lib/status";

const now = Date.parse("2026-11-01T12:00:00Z");
const at = (offset: number) => new Date(now + offset).toISOString();
const control = (
  kind: ControlStatement["kind"],
  created: number,
  expires = 60000,
): ControlStatement => ({
  ...exampleRecords["control-statement"],
  kind,
  createdAt: at(created),
  expires: at(expires),
});
describe("agent status table", () => {
  it.each([
    { heartbeatAt: undefined, controls: [], state: "offline" },
    { heartbeatAt: at(-120001), controls: [], state: "offline" },
    { heartbeatAt: "invalid", controls: [], state: "offline" },
    { heartbeatAt: at(1), controls: [], state: "offline" },
    { heartbeatAt: at(-120000), controls: [], state: "running" },
    { heartbeatAt: at(-30000), controls: [], state: "running" },
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
  ])("$state for $heartbeatAt and $controls", ({ state, ...input }) =>
    expect(agentStatus({ ...input, now }).state).toBe(state));
  it("has an unknown loading state, preserves lastSeen and restricts owner controls", () => {
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
});
const proposal: ActionProposal = {
  ...exampleRecords["action-proposal"],
  createdAt: at(-1000),
  validUntil: at(60000),
};
const approval = (decision: Approval["decision"] = "approve"): Approval => ({
  ...exampleRecords.approval,
  decision,
  approves: proposal.id,
  termsDigest: proposal.intent.termsDigest,
  createdAt: at(-500),
  expires: at(30000),
});
describe("pending approvals table", () => {
  it.each([
    "approved",
    "denied",
    "expired",
    "sent",
    "failed",
  ] as const)("excludes %s proposals", (state) =>
    expect(pendingApprovals([{ ...proposal, state }], [], [], now)).toEqual([]));
  it("includes proposed, unexpired terms with reason and lifetime", () => {
    expect(pendingApprovals([proposal], [], [], now)).toEqual([
      {
        proposal,
        reason: "confirm-required",
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
    ).toBe("prohibited");
  });
  it("shows unchecked approvals awaiting send, denial and terms changes", () => {
    expect(pendingApprovals([proposal], [approval()], [], now)[0]).toMatchObject({
      approvedAwaitingSend: true,
      needsNewApproval: false,
    });
    expect(pendingApprovals([proposal], [approval("deny")], [], now)).toEqual([]);
    const changed = { ...approval(), termsDigest: "sha-256:old" };
    expect(pendingApprovals([proposal], [changed], [], now)[0]).toMatchObject({
      needsNewApproval: true,
      reason: "Needs a new approval",
    });
    expect(
      pendingApprovals(
        [proposal],
        [
          { ...approval(), expires: at(0) },
          { ...approval(), createdAt: at(1) },
          { ...approval(), approves: "urn:other" },
        ],
        [],
        now,
      )[0]?.approvedAwaitingSend,
    ).toBe(false);
    expect(
      pendingApprovals(
        [proposal],
        [approval(), { ...approval("deny"), createdAt: at(-1) }],
        [],
        now,
      ),
    ).toEqual([]);
    expect(
      pendingApprovals(
        [proposal],
        [{ ...approval("deny"), createdAt: at(-1) }, approval()],
        [],
        now,
      ),
    ).toEqual([]);
  });
  it("distinguishes sent and incomplete transmissions and sorts newest first", () => {
    const tx = { ...exampleRecords.transmission, proposal: proposal.id };
    expect(pendingApprovals([proposal], [], [{ ...tx, status: "sent" }], now)).toEqual([]);
    expect(
      pendingApprovals([proposal], [], [tx, { ...tx, proposal: "urn:other", status: "sent" }], now),
    ).toHaveLength(1);
    const newer = { ...proposal, id: "urn:newer", createdAt: at(-1) };
    expect(pendingApprovals([proposal, newer], [], [], now).map((row) => row.proposal.id)).toEqual([
      newer.id,
      proposal.id,
    ]);
  });
});
