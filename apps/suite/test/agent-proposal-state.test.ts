// AUTHORED-BY Codex GPT-6
import type { ActionProposal, Transmission } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { describe, expect, it } from "vitest";
import { type ProposalCardState, proposalCardState } from "../src/apps/agent/lib/proposal-state";
import type { DisplayApproval } from "../src/apps/agent/lib/readers";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const proposal = {
  ...exampleRecords["action-proposal"],
  validUntil: new Date(NOW + 1000).toISOString(),
};
const approval: DisplayApproval = {
  ...exampleRecords.approval,
  approves: proposal.id,
  termsDigest: proposal.intent.termsDigest,
  createdAt: new Date(NOW - 1000).toISOString(),
  expires: new Date(NOW + 5000).toISOString(),
  verification: "verified",
  decision: "approve",
};
const tx = (status: Transmission["status"], startedAt = NOW): Transmission => ({
  ...exampleRecords.transmission,
  proposal: proposal.id,
  status,
  startedAt: new Date(startedAt).toISOString(),
});

describe("inline proposal display state", () => {
  it.each<{
    name: string;
    state?: ActionProposal["state"];
    approvals?: DisplayApproval[];
    outbox?: Transmission[];
    now?: number;
    expected: ProposalCardState;
  }>([
    { name: "pending proposal", expected: "pending" },
    { name: "record approved", state: "approved", expected: "approved" },
    { name: "record sent", state: "sent", expected: "sent" },
    { name: "record denied", state: "denied", expected: "denied" },
    { name: "record failed", state: "failed", expected: "failed" },
    { name: "record expired", state: "expired", expected: "expired" },
    { name: "still pending at expiry", now: NOW + 1000, expected: "expired" },
    { name: "approval waiting to send", approvals: [approval], expected: "approved" },
    { name: "denial", approvals: [{ ...approval, decision: "deny" }], expected: "denied" },
    {
      name: "expired approval",
      approvals: [{ ...approval, expires: new Date(NOW).toISOString() }],
      expected: "pending",
    },
    {
      name: "future approval",
      approvals: [{ ...approval, createdAt: new Date(NOW + 1).toISOString() }],
      expected: "pending",
    },
    {
      name: "unchecked approval",
      approvals: [{ ...approval, verification: "unchecked" }],
      expected: "pending",
    },
    { name: "old terms", approvals: [{ ...approval, termsDigest: "old" }], expected: "renew" },
    {
      name: "old terms past deadline",
      approvals: [{ ...approval, termsDigest: "old" }],
      now: NOW + 1000,
      expected: "expired",
    },
    {
      name: "changed terms after a failed send",
      approvals: [{ ...approval, termsDigest: "old" }],
      outbox: [tx("not-sent", NOW - 500)],
      expected: "renew",
    },
    {
      name: "newer approval after an unlinked failed send",
      approvals: [approval],
      outbox: [{ ...tx("not-sent", NOW - 2000), underApproval: undefined }],
      expected: "approved",
    },
    {
      name: "failed send linked to the current approval, despite clock skew",
      approvals: [approval],
      outbox: [{ ...tx("not-sent", NOW - 2000), underApproval: approval.id }],
      expected: "failed",
    },
    {
      name: "failed send linked to an earlier approval",
      approvals: [approval],
      outbox: [{ ...tx("not-sent", NOW - 500), underApproval: "urn:earlier-approval" }],
      expected: "approved",
    },
    {
      name: "failed send after the approval",
      approvals: [approval],
      outbox: [tx("not-sent", NOW - 500)],
      expected: "failed",
    },
    {
      name: "another proposal",
      approvals: [{ ...approval, approves: "urn:other" }],
      outbox: [{ ...tx("sent"), proposal: "urn:other" }],
      expected: "pending",
    },
    { name: "sent outbox after expiry", outbox: [tx("sent")], now: NOW + 10000, expected: "sent" },
    { name: "failed outbox", outbox: [tx("not-sent")], expected: "failed" },
    { name: "refused outbox", outbox: [tx("refused")], expected: "failed" },
    { name: "uncertain outbox", outbox: [tx("uncertain")], expected: "failed" },
    {
      name: "attempting approved send",
      approvals: [approval],
      outbox: [tx("attempting")],
      expected: "approved",
    },
    {
      name: "newer attempt follows failure",
      approvals: [approval],
      outbox: [tx("not-sent", NOW - 2), tx("attempting", NOW - 1)],
      expected: "approved",
    },
    {
      name: "sent is permanent",
      state: "failed",
      outbox: [tx("sent"), tx("not-sent", NOW + 1)],
      expected: "sent",
    },
    {
      name: "approved record past deadline",
      state: "approved",
      now: NOW + 10000,
      expected: "approved",
    },
    { name: "denied record past deadline", state: "denied", now: NOW + 10000, expected: "denied" },
    { name: "failed record past deadline", state: "failed", now: NOW + 10000, expected: "failed" },
    {
      name: "approved past proposal deadline",
      approvals: [approval],
      now: NOW + 1000,
      expected: "approved",
    },
    {
      name: "denial wins a tied decision",
      approvals: [approval, { ...approval, decision: "deny" }],
      expected: "denied",
    },
    {
      name: "tied approval after denial",
      approvals: [{ ...approval, decision: "deny" }, approval],
      expected: "denied",
    },
    {
      name: "newest decision",
      approvals: [
        { ...approval, decision: "deny", createdAt: new Date(NOW - 2).toISOString() },
        approval,
      ],
      expected: "denied",
    },
  ])("$name → $expected", ({ state, approvals = [], outbox = [], now = NOW, expected }) => {
    expect(
      proposalCardState({ ...proposal, state: state ?? "proposed" }, approvals, outbox, now),
    ).toBe(expected);
  });
});
