// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync, readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { digestOf } from "../core/canonical.js";
import type { AuthorisationDecision } from "../core/types.js";
import { MemoryLedger } from "../store/ledger.js";
import {
  changeCommitment,
  generateFaults,
  laterMessage,
  type PartyRecord,
  whoWasAtFault,
} from "./faults.js";
import { mutations, unspecified } from "./mutations.js";
import {
  type PropertyInput,
  properties,
  readMandate,
  readPolicy,
  readTerms,
} from "./properties.js";

function fixture(): PropertyInput {
  const proposal = {
    action: "use",
    operation: "urn:op:fictional",
    target: "urn:op:fictional",
    recipient: "urn:party:peer",
    purpose: "urn:purpose:task",
    parameters: {},
    conversation: "urn:conversation:one",
  };
  const mandate = {
    type: "OwnerMandate" as const,
    id: "urn:mandate:one",
    version: 1,
    issuer: "urn:party:owner",
    subject: "urn:actor:one",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    autonomous: {
      id: "urn:policy:auto",
      permissions: [
        { type: "permission" as const, action: "use" as const, target: proposal.target },
      ],
    },
    withApproval: { id: "urn:policy:ask" },
  };
  const authorisation: AuthorisationDecision = {
    type: "authorisation-decision",
    decider: mandate.subject,
    actionDigest: digestOf(proposal),
    action: proposal,
    policy: { id: mandate.id, digest: digestOf(mandate), evaluator: "urn:test:evaluator" },
    outcome: "permit",
    basis: "autonomous",
    reason: "within-mandate",
    at: "2026-11-13T09:00:00.000Z",
  };
  return {
    mandate,
    proposal,
    state: {
      actor: mandate.subject,
      at: authorisation.at,
      withdrawn: false,
      items: [],
      approvals: {},
      admissionDigests: [],
      shownDigests: [],
    },
    decision: { outcome: "go", authorisation },
    record: { decisions: [authorisation], beforeEffect: true },
  };
}

describe("five E0 obligations", () => {
  it("A1 independently refuses an ungranted action, target and recipient", () => {
    const x = fixture();
    expect(properties["A1-mandate"](x)).toBe(true);
    x.proposal = { ...x.proposal, action: "distribute" };
    expect(properties["A1-mandate"](x)).toBe(false);
    x.proposal = { ...x.proposal, action: "use", target: "urn:op:other" };
    expect(readMandate(x.mandate, x.state, x.proposal)).toBe("deny");
    x.proposal = { ...x.proposal, target: "urn:op:fictional" };
    if (x.mandate)
      x.mandate = {
        ...x.mandate,
        autonomous: {
          id: "urn:policy:auto",
          permissions: [
            {
              type: "permission",
              action: "use",
              target: x.proposal.target,
              constraints: [
                { leftOperand: "recipient", operator: "eq", rightOperand: "urn:party:other" },
              ],
            },
          ],
        },
      };
    expect(properties["A1-mandate"](x)).toBe(false);
  });
  it("A2 checks each attached item's recipient, purpose and default terms", () => {
    const x = fixture();
    const item = {
      id: "urn:item:one",
      label: "Fictional item",
      claimType: "sample",
      source: "urn:source:one",
      digest: "sha-256:one",
      kind: "statement" as const,
      admittedPurpose: x.proposal.purpose,
    };
    x.state.items = [item];
    x.proposal = { ...x.proposal, parameters: { evidence: [item.id] } };
    expect(properties["A2-item-terms"](x)).toBe(false);
    expect(
      readTerms(
        {
          policy: {
            id: "urn:terms:one",
            permissions: [
              {
                type: "permission",
                action: "distribute",
                target: item.id,
                constraints: [
                  { leftOperand: "purpose", operator: "eq", rightOperand: "urn:purpose:other" },
                ],
              },
            ],
          },
        },
        item,
        x.state,
        x.proposal,
      ),
    ).toBe("deny");
    x.decision.outcome = "stop";
    expect(properties["A2-item-terms"](x)).toBe(true);
  });
  it("A3 needs prior admission for every context digest, including opaque content", () => {
    const x = fixture();
    x.state.items = [
      {
        id: "urn:item:one",
        label: "Fictional content",
        claimType: "opaque",
        source: "urn:source:one",
        kind: "content",
        accepted: false,
        digest: "sha-256:one",
      },
    ];
    expect(properties["A3-inbound-before-context"](x)).toBe(false);
    x.state.admissionDigests = ["sha-256:one"];
    expect(properties["A3-inbound-before-context"](x)).toBe(true);
  });
  it("A4 needs a matching durable decision before an effect, for go and stop", () => {
    const x = fixture();
    expect(properties["A4-record-before-action"](x)).toBe(true);
    x.record.beforeEffect = false;
    expect(properties["A4-record-before-action"](x)).toBe(false);
    x.record.beforeEffect = true;
    x.record.decisions = [];
    expect(properties["A4-record-before-action"](x)).toBe(false);
    x.decision.outcome = "stop";
    expect(properties["A4-record-before-action"](x)).toBe(false);
    x.record.decisions = [{ ...x.decision.authorisation, outcome: "deny" }];
    expect(properties["A4-record-before-action"](x)).toBe(true);
    x.record.decisions = [];
    x.record.releases = [{ digest: digestOf(x.proposal), outcome: "stop" }];
    expect(properties["A4-record-before-action"](x)).toBe(true);
  });
  it("A5 binds the approval to the action and to the displayed digest", () => {
    const x = fixture();
    const digest = digestOf(x.proposal);
    x.decision.authorisation = {
      ...x.decision.authorisation,
      basis: "owner-approval",
      approval: "urn:approval:one",
    };
    expect(properties["A5-exact-approval"](x)).toBe(false);
    x.state.approvals = { [digest]: { id: "urn:approval:one", decision: "approve" } };
    expect(properties["A5-exact-approval"](x)).toBe(false);
    x.state.shownDigests = [digest];
    expect(properties["A5-exact-approval"](x)).toBe(true);
    x.proposal = { ...x.proposal, recipient: "urn:party:other" };
    expect(properties["A5-exact-approval"](x)).toBe(false);
    const { approval: _approval, ...withoutApproval } = x.decision.authorisation;
    x.decision.authorisation = withoutApproval;
    expect(properties["A5-exact-approval"](x)).toBe(false);
  });
  it("keeps unimplemented policy constructs unresolved and honours prohibitions", () => {
    const x = fixture();
    expect(
      readPolicy({ id: "urn:p", profile: "urn:custom" }, x.proposal, x.state.actor, x.state.at),
    ).toBe("unknown");
    expect(
      readPolicy(
        {
          id: "urn:p",
          permissions: [{ type: "permission", action: "use", target: x.proposal.target }],
          prohibitions: [{ type: "prohibition", action: "use" }],
        },
        x.proposal,
        x.state.actor,
        x.state.at,
      ),
    ).toBe("deny");
    x.state.withdrawn = true;
    expect(readMandate(x.mandate, x.state, x.proposal)).toBe("deny");
  });
});

describe("mutation expectations", () => {
  it("every row names an existing clause and an expectation or two explicit readings", () => {
    const directories = [
      resolve("../../docs/specs/agent"),
      "/mnt/project-files/agent-architecture/specs",
    ];
    const directory = directories.find(existsSync);
    const index = JSON.parse(readFileSync(resolve("eval/e0/spec-clauses.json"), "utf8")) as {
      clauses: Record<string, { source: string; sha256: string }>;
    };
    const text = directory
      ? readdirSync(directory)
          .filter((f) => f.endsWith(".md"))
          .map((f) => readFileSync(resolve(directory, f), "utf8"))
          .join("\n")
      : undefined;
    expect(new Set(mutations.map((r) => r.id)).size).toBe(mutations.length);
    for (const row of mutations) {
      expect(index.clauses[row.clause]?.source).toMatch(/\.md$/);
      expect(index.clauses[row.clause]?.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (text) expect(text).toContain(`**${row.clause}.`);
      if (row.check === null || row.verdict === null || row.reason === null)
        expect(unspecified[row.id]).toHaveLength(2);
      else {
        expect(row.check.length).toBeGreaterThan(0);
        expect(row.verdict.length).toBeGreaterThan(0);
        expect(row.reason.length).toBeGreaterThan(0);
      }
    }
  }, 60_000);
  it("every unspecified row has two distinct readings and exists in the table", () => {
    for (const [id, readings] of Object.entries(unspecified)) {
      expect(mutations.some((r) => r.id === id)).toBe(true);
      expect(readings).toHaveLength(2);
      expect(readings[0]).not.toBe(readings[1]);
    }
  });
});

function records(): [PartyRecord, PartyRecord] {
  return [
    { party: "urn:party:alder", actor: "urn:actor:alder", entries: [], messages: [] },
    { party: "urn:party:birch", actor: "urn:actor:birch", entries: [], messages: [] },
  ];
}
describe("fault generator and record-only checker", () => {
  it("changes one commitment field, preserves both identities, and leaves the source intact", () => {
    const message = {
      id: "urn:message:one",
      kind: "propose",
      from: { actor: "urn:actor:a" },
      to: { actor: "urn:actor:b" },
      body: { terms: { amount: 10, fee: 2 } },
    };
    const changed = changeCommitment(message);
    expect(changed).toEqual({ ...message, body: { terms: { amount: 10, fee: 3 } } });
    expect(message.body.terms.fee).toBe(2);
    expect(() => changeCommitment({ kind: "receipt", body: {} })).toThrow(
      "no structured commitment",
    );
  });
  it("generates all six variants with exactly one culpable party, deduplicating parties", () => {
    const plans = generateFaults(["urn:party:a", "urn:party:b", "urn:party:a"]);
    expect(plans).toHaveLength(12);
    expect(plans.filter((p) => p.party === "urn:party:a")).toHaveLength(6);
    expect(plans.every((p) => Object.keys(p).sort().join(",") === "kind,party")).toBe(true);
  });
  it("does not infer a fault from a missing receipt or from record order", () => {
    const [a, b] = records();
    expect(whoWasAtFault(a, b)).toMatchObject({ result: "cannot-tell" });
    expect(whoWasAtFault(a, b)).toEqual(whoWasAtFault(b, a));
  });
  it("needs an observed act after withdrawal, and does not blame a stopped proposal", () => {
    const [a, b] = records();
    const ledger = new MemoryLedger();
    const x = fixture();
    ledger.append({ type: "mandate-revoked", mandate: x.mandate?.id }, x.state.at);
    ledger.append({ ...x.decision.authorisation, outcome: "deny" }, x.state.at);
    a.entries = ledger.entries();
    expect(whoWasAtFault(a, b)).toMatchObject({ result: "cannot-tell" });
    const message = laterMessage(
      {
        id: "urn:m:one",
        kind: "invoke",
        from: { actor: a.actor },
        to: { actor: b.actor },
        body: { purpose: "urn:purpose:task" },
      },
      x.state.at,
    );
    const jws = `e30.${Buffer.from(JSON.stringify(message)).toString("base64url")}.fixture`;
    a.messages = [{ direction: "out", jws }];
    b.messages = [{ direction: "in", jws }];
    expect(whoWasAtFault(a, b)).toMatchObject({ party: a.party, clause: "CORE-OUT-10" });
    expect(whoWasAtFault(b, a)).toEqual(whoWasAtFault(a, b));
  });
  it("generates a later purpose change without changing either party or the original", () => {
    const message = {
      id: "urn:m:one",
      kind: "invoke",
      from: { actor: "urn:actor:a" },
      to: { actor: "urn:actor:b" },
      body: { purpose: "urn:purpose:task" },
    };
    const later = laterMessage(message, "2026-11-13T09:00:00.000Z", "urn:purpose:outside");
    expect(later.from).toEqual(message.from);
    expect(later.to).toEqual(message.to);
    expect(later.createdAt).toBe("2026-11-13T09:00:01.000Z");
    expect(message.body.purpose).toBe("urn:purpose:task");
    expect(later.id).not.toBe(message.id);
  });
  it("attributes a carried item sent for a purpose its recorded terms exclude", () => {
    const [a, b] = records();
    const wire = (value: unknown) =>
      `e30.${Buffer.from(JSON.stringify(value)).toString("base64url")}.fixture`;
    const claim = {
      id: "urn:item:one",
      issuer: "urn:source:one",
      claimType: "sample",
      terms: {
        policy: {
          id: "urn:terms:one",
          permissions: [
            {
              type: "permission",
              action: "distribute",
              target: "urn:item:one",
              constraints: [
                { leftOperand: "purpose", operator: "eq", rightOperand: "urn:purpose:task" },
              ],
            },
          ],
        },
      },
    };
    b.messages = [
      {
        direction: "in",
        jws: wire({
          from: { actor: a.actor },
          createdAt: "2026-11-13T09:00:00.000Z",
          body: { purpose: "urn:purpose:outside" },
          evidence: [{ role: "credential", value: wire(claim) }],
        }),
      },
    ];
    expect(whoWasAtFault(a, b)).toMatchObject({ party: a.party, clause: "CORE-OUT-5" });
  });
  it("compares an acceptance with the action digest actually approved in the record", () => {
    const [a, b] = records();
    const x = fixture();
    const ledger = new MemoryLedger();
    const action = { ...x.proposal, parameters: { termsDigest: "sha-256:approved" } };
    const actionDigest = digestOf(action);
    ledger.append({ ...x.decision.authorisation, action, actionDigest }, x.state.at);
    ledger.append(
      { type: "approval", id: "urn:approval:one", actionDigest, decision: "approve" },
      x.state.at,
    );
    a.entries = ledger.entries();
    const message = {
      kind: "accept",
      from: { actor: a.actor },
      conversation: action.conversation,
      createdAt: x.state.at,
      body: { termsDigest: "sha-256:different" },
    };
    b.messages = [
      {
        direction: "in",
        jws: `e30.${Buffer.from(JSON.stringify(message)).toString("base64url")}.fixture`,
      },
    ];
    expect(whoWasAtFault(a, b)).toMatchObject({ party: a.party, clause: "CORE-OUT-7" });
  });
  it("does not blame a later replacement mandate and detects tampered records", () => {
    const [a, b] = records();
    const ledger = new MemoryLedger();
    const x = fixture();
    ledger.append({ type: "mandate-revoked", mandate: "urn:mandate:old" }, x.state.at);
    ledger.append(x.decision.authorisation, x.state.at);
    a.entries = ledger.entries();
    expect(whoWasAtFault(a, b)).toMatchObject({ result: "cannot-tell" });
    a.entries = a.entries.map((e) => ({ ...e, hash: "sha-256:tampered" }));
    expect(whoWasAtFault(a, b)).toMatchObject({
      result: "cannot-tell",
      reason: "A supplied record has a broken hash chain.",
    });
  });
  it("finds a signed denial that contradicts the same party's earlier receipt", () => {
    const [a, b] = records();
    const wire = (body: unknown) =>
      `e30.${Buffer.from(JSON.stringify(body)).toString("base64url")}.fixture`;
    a.messages = [
      {
        direction: "out",
        jws: wire({
          id: "urn:receipt:one",
          kind: "receipt",
          from: { actor: a.actor },
          inReplyTo: "urn:message:one",
          body: {},
        }),
      },
    ];
    b.messages = [
      {
        direction: "in",
        jws: wire({ issuer: a.actor, received: false, message: "urn:message:one" }),
      },
    ];
    expect(whoWasAtFault(a, b)).toMatchObject({ party: a.party, clause: "AC-2" });
    b.messages = [
      {
        direction: "in",
        jws: wire({ issuer: b.actor, received: false, message: "urn:message:one" }),
      },
    ];
    expect(whoWasAtFault(a, b)).toMatchObject({ result: "cannot-tell" });
  });
});
