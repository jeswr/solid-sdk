// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { AnyMessage } from "../src/core/types.js";
import { GateMemory } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { FictionalDeliberationPlatform } from "../src/standins/deliberation.js";
import { BASELINE } from "../src/suites/baseline.js";

async function fixture() {
  const [platform, proposer, peer, sam, lender] = await Promise.all([
    testKey("term-platform"),
    testKey("term-proposer"),
    testKey("term-peer"),
    testKey("term-sam"),
    testKey("term-lender"),
  ]);
  const settings = {
    platform: "platform",
    proposer: "proposer",
    peer: "peer",
    term: "urn:term:irregular-income:v1",
    definition: "Sum the twelve recorded monthly gross amounts.",
    version: "1",
    operation: "urn:op:mortgage",
  };
  const service = new FictionalDeliberationPlatform(
    "urn:platform",
    platform,
    { identity: "urn:agent:sam", key: proposer },
    { "urn:sam": sam, "urn:lender": lender },
    { identity: "urn:agent:lender", key: peer },
    settings,
  );
  const proposal = {
    type: "TermProposal",
    issuer: "urn:agent:sam",
    term: settings.term,
    definition: settings.definition,
    version: "1",
    exchange: "urn:exchange:one",
    principals: ["urn:sam", "urn:lender"],
  };
  const signed = await signStatement(proposer, "awp-term-proposal+jws", proposal);
  const accepted = await signStatement(peer, "awp-term-agent-acceptance+jws", {
    type: "TermAgentAcceptance",
    issuer: "urn:agent:lender",
    exchange: proposal.exchange,
    proposalDigest: digestOf(proposal),
  });
  const approval = (issuer: string) => ({
    type: "TermApproval",
    issuer,
    term: settings.term,
    exchange: proposal.exchange,
    proposalDigest: digestOf(proposal),
    decision: "approve",
    validUntil: "2026-11-14T00:00:00Z",
  });
  const approvals = await Promise.all(
    [
      ["urn:sam", sam],
      ["urn:lender", lender],
    ].map(([identity, key]) =>
      signStatement(key as typeof sam, "awp-term-approval+jws", approval(identity as string)),
    ),
  );
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [],
    sourceAuthority: [
      {
        id: "urn:rule:terms",
        version: "1",
        source: "urn:platform",
        claimTypes: ["term.deliberation"],
        subjects: [settings.term],
      },
    ],
  });
  return { service, signed, accepted, approvals, trust, proposal, proposer, approval, sam };
}

it("records agent agreement without inventing a person's approval, and scopes approvals to both principals and one exchange", async () => {
  const f = await fixture();
  await f.service.record(f.signed, f.accepted, []);
  const check = (
    exchange = f.proposal.exchange,
    at = "2026-11-13T09:00:00Z",
    peer = "urn:lender",
  ) => f.service.approved(exchange, "urn:sam", peer, at, f.trust, "urn:agent:sam");
  expect(check()).toBe(false);
  await f.service.record(f.signed, f.accepted, [f.approvals[0]!]);
  expect(check()).toBe(false);
  await f.service.record(f.signed, f.accepted, f.approvals);
  expect(check()).toBe(true);
  expect(check("urn:exchange:two")).toBe(false);
  expect(check(undefined, "2026-11-14T00:00:00Z")).toBe(false);
  expect(check(undefined, undefined, "urn:stranger")).toBe(false);
  const unaccepted = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [],
    sourceAuthority: [],
  });
  expect(
    f.service.approved(
      f.proposal.exchange,
      "urn:sam",
      "urn:lender",
      "2026-11-13T09:00:00Z",
      unaccepted,
      "urn:agent:sam",
    ),
  ).toBe(false);
});

it("rejects an agent signing as a person, a changed definition and approval for different bytes", async () => {
  const f = await fixture();
  const forged = await signStatement(f.proposer, "awp-term-approval+jws", f.approval("urn:sam"));
  await expect(f.service.record(f.signed, f.accepted, [forged])).rejects.toThrow(/approval/);
  const other = await signStatement(f.sam, "awp-term-approval+jws", {
    ...f.approval("urn:sam"),
    proposalDigest: "sha-256:other",
  });
  await expect(f.service.record(f.signed, f.accepted, [other])).rejects.toThrow(/exact term/);
  const changed = await signStatement(f.proposer, "awp-term-proposal+jws", {
    ...f.proposal,
    definition: "Use a larger amount.",
  });
  await expect(f.service.record(changed, f.accepted, f.approvals)).rejects.toThrow(/scope/);
});

it("rechecks term approval at the message boundary even when a generic action approval is supplied", async () => {
  const f = await fixture();
  await f.service.record(f.signed, f.accepted, []);
  const offered = {
    evidenceRequest: [
      {
        claimType: "income.gross.monthly-series",
        incomeDefinition: { term: f.proposal.term },
      },
    ],
  };
  const operation = f.service.settings.operation;
  const gate = new OutboundGate({
    identity: { actor: "urn:agent:sam", party: "urn:sam" },
    now: () => "2026-11-13T09:00:00Z",
    mandate: () => undefined,
    gate: {
      configuration: BASELINE,
      negotiatedMeaning: {
        operation,
        term: f.proposal.term,
        approved: (exchange, principal, peer, at) =>
          f.service.approved(exchange, principal, peer, at, f.trust, "urn:agent:sam"),
      },
    },
    memory: new GateMemory(),
    isReplyTo: () => true,
    offerTerms: (digest) => (digest === digestOf(offered) ? offered : undefined),
  });
  const message = {
    profile: "https://w3id.org/jeswr/awp#profile/pilot/0.1",
    configuration: BASELINE.pilotConfiguration,
    id: "urn:accept:negotiated-term",
    conversation: f.proposal.exchange,
    kind: "accept",
    from: { actor: "urn:agent:sam", onBehalfOf: "urn:sam" },
    to: { actor: "urn:agent:lender", party: "urn:lender" },
    createdAt: "2026-11-13T09:00:00Z",
    expiresAt: "2026-11-13T10:00:00Z",
    body: {
      proposal: "urn:lender:proposal",
      agreement: "urn:lender:agreement",
      termsDigest: digestOf(offered),
    },
  } as AnyMessage;
  expect(gate.checkMessage(message, { operation, approved: true })).toMatchObject({
    outcome: "ask-principal",
    reason: "approval-required",
  });
});
