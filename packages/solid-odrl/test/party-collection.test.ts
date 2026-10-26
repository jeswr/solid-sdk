// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DatasetWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { decisionRecord, decisionRecordJsonLd, recordEvaluation } from "../src/decision-record.js";
import { evaluateDelegated } from "../src/delegation.js";
import { constraintSatisfied, evaluate, matchingPermissions } from "../src/evaluate.js";
import { ODRL_IS_PART_OF } from "../src/index.js";
import {
  OdrlSerializationError,
  parsePolicy,
  policyToJsonLd,
  policyToTurtle,
} from "../src/policy.js";
import type { EvaluateOptions, OdrlConstraint, OdrlPolicy, RequestContext } from "../src/types.js";
import {
  IRI_TO_OPERATOR,
  ODRL,
  ODRL_ACTION,
  ODRL_CONSTRAINT,
  ODRL_LEFT_OPERAND,
  ODRL_OPERATOR,
  ODRL_PERMISSION,
  ODRL_PERMISSION_CLASS,
  ODRL_RIGHT_OPERAND,
  ODRL_SET,
  OPERATOR_IRI,
  RDF_TYPE,
  XSD,
} from "../src/vocab.js";
import { GraphBuilder, RuleNode, wrapPolicy } from "../src/wrappers.js";

const COLLECTION = "https://alice.example/parties/organisation";
const OTHER_COLLECTION = "https://alice.example/parties/other";
const MEMBER = "https://bob.example/profile/card#me";
const OUTSIDER = "https://carol.example/profile/card#me";
const NOW = new Date("2026-10-26T12:00:00Z");
const CONSTRAINT: OdrlConstraint = {
  leftOperand: "recipient",
  operator: "isPartOf",
  rightOperand: COLLECTION,
};
const POLICY: OdrlPolicy = {
  id: "https://alice.example/policies/organisation",
  permissions: [{ type: "permission", action: "distribute", constraints: [CONSTRAINT] }],
};
const REQUEST: RequestContext = { action: "distribute", attributes: { recipient: MEMBER } };
const OPTIONS: EvaluateOptions = {
  now: NOW,
  resolvePartyCollection: (iri) => (iri === COLLECTION ? new Set([MEMBER]) : undefined),
};

function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}

describe("recipient isPartOf evaluation", () => {
  it("permits a member and exposes the matching permission", () => {
    expect(evaluate(POLICY, REQUEST, OPTIONS).decision).toBe("permit");
    expect(matchingPermissions(POLICY, REQUEST, OPTIONS)).toEqual(POLICY.permissions);
    expect(constraintSatisfied(CONSTRAINT, REQUEST, NOW, OPTIONS)).toBe(true);
  });

  it("does not permit a non-member or compare only the recipient's origin", () => {
    for (const recipient of [OUTSIDER, MEMBER.replace("#me", "#other"), COLLECTION]) {
      const request = { ...REQUEST, attributes: { recipient } };
      expect(evaluate(POLICY, request, OPTIONS).decision).toBe("notApplicable");
      expect(matchingPermissions(POLICY, request, OPTIONS)).toEqual([]);
    }
  });

  it("does not permit without a resolver", () => {
    expect(evaluate(POLICY, REQUEST, { now: NOW }).decision).toBe("notApplicable");
    expect(constraintSatisfied(CONSTRAINT, REQUEST, NOW)).toBe(false);
  });

  it("does not bypass other constraints for a member", () => {
    const policy: OdrlPolicy = {
      id: POLICY.id,
      permissions: [
        {
          type: "permission",
          action: "distribute",
          constraints: [
            CONSTRAINT,
            { leftOperand: "purpose", operator: "eq", rightOperand: "urn:example:research" },
          ],
        },
      ],
    };
    expect(evaluate(policy, REQUEST, OPTIONS).decision).toBe("notApplicable");
  });

  it("does not permit an unknown or empty collection", () => {
    for (const members of [undefined, new Set<string>()]) {
      const resolvePartyCollection = vi.fn(() => members);
      expect(evaluate(POLICY, REQUEST, { resolvePartyCollection }).decision).toBe("notApplicable");
      expect(resolvePartyCollection).toHaveBeenCalledWith(COLLECTION);
    }
  });

  it("fails closed when the resolver throws", () => {
    const resolvePartyCollection = () => {
      throw new Error("Collection unavailable");
    };
    expect(evaluate(POLICY, REQUEST, { resolvePartyCollection }).decision).toBe("notApplicable");
  });

  it.each([
    undefined,
    true,
    42,
    "bob",
    "/profile#me",
    "",
    `${MEMBER} `,
    `${MEMBER}/a b`,
    [MEMBER],
  ])("rejects a missing, non-IRI, or non-scalar recipient: %j", (recipient) => {
    const resolvePartyCollection = vi.fn(() => new Set([String(recipient)]));
    const request: RequestContext = {
      ...REQUEST,
      ...(recipient !== undefined && { attributes: { recipient } }),
    };
    // Remove REQUEST's member attribute for the absent-value case.
    const actual = recipient === undefined ? { action: REQUEST.action } : request;
    expect(evaluate(POLICY, actual, { resolvePartyCollection }).decision).toBe("notApplicable");
    expect(resolvePartyCollection).not.toHaveBeenCalled();
  });

  it.each([
    42,
    "organisation",
    "",
    `${COLLECTION} `,
    `${COLLECTION}/a b`,
    [COLLECTION],
    [],
  ])("rejects a non-IRI or non-scalar collection: %j", (rightOperand) => {
    const resolvePartyCollection = vi.fn(() => new Set([MEMBER]));
    expect(
      constraintSatisfied({ ...CONSTRAINT, rightOperand }, REQUEST, NOW, {
        resolvePartyCollection,
      }),
    ).toBe(false);
    expect(resolvePartyCollection).not.toHaveBeenCalled();
  });

  it("does not apply collection membership to another left operand or a typed literal", () => {
    expect(
      constraintSatisfied(
        { ...CONSTRAINT, leftOperand: "purpose" },
        { ...REQUEST, attributes: { purpose: MEMBER } },
        NOW,
        OPTIONS,
      ),
    ).toBe(false);
    expect(
      constraintSatisfied({ ...CONSTRAINT, datatype: `${XSD}string` }, REQUEST, NOW, OPTIONS),
    ).toBe(false);
  });

  it("uses lexical IRI identity and supports non-HTTP IRIs", () => {
    const recipient = "did:example:bob";
    const collection = "urn:example:organisation";
    const resolvePartyCollection = vi.fn((iri: string) =>
      iri === collection ? new Set([recipient]) : undefined,
    );
    expect(
      constraintSatisfied(
        { ...CONSTRAINT, rightOperand: collection },
        { ...REQUEST, attributes: { recipient } },
        NOW,
        { resolvePartyCollection },
      ),
    ).toBe(true);
    expect(resolvePartyCollection).toHaveBeenCalledWith(collection);
  });

  it("denies a member under a prohibition, including a conflicting permission", () => {
    const prohibition: OdrlPolicy = {
      id: POLICY.id,
      prohibitions: [{ type: "prohibition", action: "distribute", constraints: [CONSTRAINT] }],
    };
    expect(evaluate(prohibition, REQUEST, OPTIONS).decision).toBe("deny");
    expect(
      evaluate(
        { ...prohibition, permissions: [{ type: "permission", action: "distribute" }] },
        REQUEST,
        OPTIONS,
      ).decision,
    ).toBe("deny");
    expect(
      evaluate(prohibition, { ...REQUEST, attributes: { recipient: OUTSIDER } }, OPTIONS).decision,
    ).toBe("notApplicable");
    expect(evaluate(prohibition, REQUEST).decision).toBe("notApplicable");
    expect(
      evaluate(prohibition, REQUEST, { resolvePartyCollection: () => undefined }).decision,
    ).toBe("notApplicable");
  });

  it.each([
    "permission",
    "obligation",
  ])("gates %s duty fulfilment with the same resolver", (kind) => {
    const duty = { action: "inform" as const, constraints: [CONSTRAINT] };
    const policy: OdrlPolicy = {
      id: POLICY.id,
      permissions: [
        {
          type: "permission",
          action: "distribute",
          ...(kind === "permission" && { duties: [duty] }),
        },
      ],
      ...(kind === "obligation" && { obligations: [duty] }),
    };
    const request = { ...REQUEST, attributes: { recipient: MEMBER, "fulfilled:inform": true } };
    expect(evaluate(policy, request, { ...OPTIONS, requireDuties: true }).decision).toBe("permit");
    expect(evaluate(policy, request, { requireDuties: true }).decision).toBe("deny");
    expect(
      evaluate(
        policy,
        { ...request, attributes: { ...request.attributes, recipient: OUTSIDER } },
        { ...OPTIONS, requireDuties: true },
      ).decision,
    ).toBe("deny");
  });
});

describe("recipient isPartOf RDF", () => {
  it.each([
    "text/turtle",
    "application/ld+json",
  ])("round-trips %s without dropping the constraint", async (contentType) => {
    const body =
      contentType === "text/turtle"
        ? await policyToTurtle(POLICY)
        : JSON.stringify(policyToJsonLd(POLICY));
    const dataset = await parseRdf(body, contentType);
    const policyNode = required(wrapPolicy(dataset).policies()[0]);
    const ruleNode = required([...policyNode.permissions][0]);
    const constraint = required([...ruleNode.constraints][0]);
    expect([...constraint.operators].map((term) => term.value)).toEqual([`${ODRL}isPartOf`]);
    expect([...constraint.rightOperands].map((term) => [term.termType, term.value])).toEqual([
      ["NamedNode", COLLECTION],
    ]);
    const parsed = required(await parsePolicy(dataset));
    expect(parsed?.permissions?.[0]?.constraints).toEqual([CONSTRAINT]);
    expect(evaluate(parsed, REQUEST, OPTIONS).decision).toBe("permit");
    expect(evaluate(parsed, REQUEST).decision).toBe("notApplicable");
    expect(
      evaluate(parsed, { ...REQUEST, attributes: { recipient: OUTSIDER } }, OPTIONS).decision,
    ).toBe("notApplicable");
    expect(OPERATOR_IRI.isPartOf).toBe(`${ODRL}isPartOf`);
    expect(ODRL_IS_PART_OF).toBe(`${ODRL}isPartOf`);
    expect(IRI_TO_OPERATOR[`${ODRL}isPartOf`]).toBe("isPartOf");
  });

  it.each([
    "literal",
    "blank",
    "missing",
    "multiple",
    "mixed",
    "relative IRI",
  ])("keeps malformed %s collection operands unsatisfied", async (kind) => {
    const b = new GraphBuilder();
    b.addIri(POLICY.id, RDF_TYPE, ODRL_SET);
    const rule = b.linkBlankNode(POLICY.id, ODRL_PERMISSION);
    b.addIri(rule, ODRL_ACTION, `${ODRL}distribute`);
    const c = b.linkBlankNode(rule, ODRL_CONSTRAINT);
    b.addIri(c, ODRL_LEFT_OPERAND, `${ODRL}recipient`);
    b.addIri(c, ODRL_OPERATOR, `${ODRL}isPartOf`);
    if (kind === "literal" || kind === "mixed") b.addLiteral(c, ODRL_RIGHT_OPERAND, COLLECTION);
    if (kind === "blank") b.linkBlankNode(c, ODRL_RIGHT_OPERAND);
    if (kind === "multiple" || kind === "mixed") b.addIri(c, ODRL_RIGHT_OPERAND, COLLECTION);
    if (kind === "multiple") b.addIri(c, ODRL_RIGHT_OPERAND, OTHER_COLLECTION);
    if (kind === "relative IRI") b.addIri(c, ODRL_RIGHT_OPERAND, "organisation");
    const parsed = required(await parsePolicy(b.dataset()));
    expect(parsed?.permissions?.[0]?.constraints).toHaveLength(1);
    expect(evaluate(parsed, REQUEST, OPTIONS).decision).toBe("notApplicable");
  });

  it.each([
    "missing left",
    "unknown left",
    "literal left",
    "multiple lefts",
    "literal operator",
    "multiple operators",
  ])("retains an unsatisfied constraint with %s", async (kind) => {
    const b = new GraphBuilder();
    b.addIri(POLICY.id, RDF_TYPE, ODRL_SET);
    const rule = b.linkBlankNode(POLICY.id, ODRL_PERMISSION);
    b.addIri(rule, ODRL_ACTION, `${ODRL}distribute`);
    const c = b.linkBlankNode(rule, ODRL_CONSTRAINT);
    if (kind === "literal left") b.addLiteral(c, ODRL_LEFT_OPERAND, `${ODRL}recipient`);
    else if (kind === "unknown left") b.addIri(c, ODRL_LEFT_OPERAND, "urn:example:unknown");
    else if (kind !== "missing left") b.addIri(c, ODRL_LEFT_OPERAND, `${ODRL}recipient`);
    if (kind === "multiple lefts") b.addIri(c, ODRL_LEFT_OPERAND, `${ODRL}purpose`);
    if (kind === "literal operator") b.addLiteral(c, ODRL_OPERATOR, `${ODRL}isPartOf`);
    else b.addIri(c, ODRL_OPERATOR, `${ODRL}isPartOf`);
    if (kind === "multiple operators") b.addIri(c, ODRL_OPERATOR, `${ODRL}eq`);
    b.addIri(c, ODRL_RIGHT_OPERAND, COLLECTION);
    const parsed = required(await parsePolicy(b.dataset()));
    expect(parsed.permissions?.[0]?.constraints).toHaveLength(1);
    expect(evaluate(parsed, REQUEST, OPTIONS).decision).toBe("notApplicable");
  });

  it.each([
    { ...CONSTRAINT, rightOperand: [COLLECTION] },
    { ...CONSTRAINT, rightOperand: [] },
    { ...CONSTRAINT, rightOperand: 42 },
    { ...CONSTRAINT, rightOperand: "organisation" },
    { ...CONSTRAINT, rightOperand: `${COLLECTION}/a b` },
    { ...CONSTRAINT, datatype: `${XSD}string` },
    { ...CONSTRAINT, leftOperand: "purpose" as const },
  ])("refuses to serialize malformed membership constraints: %j", async (constraint) => {
    const policy: OdrlPolicy = {
      id: POLICY.id,
      permissions: [{ type: "permission", action: "distribute", constraints: [constraint] }],
    };
    expect(() => policyToTurtle(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(policy)).toThrow(OdrlSerializationError);
  });
});

describe("recipient isPartOf delegated evaluation", () => {
  it("forwards the resolver through single-policy evaluation", () => {
    expect(evaluateDelegated([POLICY], REQUEST, OPTIONS).decision).toBe("permit");
    expect(evaluateDelegated([POLICY], REQUEST).decision).toBe("deny");
  });

  it("checks membership through delegation authorization, scope, leaf, and duties", () => {
    const agent = "https://agent.example/profile#me";
    const subagent = "https://subagent.example/profile#me";
    const root: OdrlPolicy = {
      id: POLICY.id,
      permissions: [
        {
          type: "permission",
          action: "grantUse",
          assignee: agent,
          constraints: [CONSTRAINT],
          duties: [{ action: "inform", constraints: [CONSTRAINT] }],
        },
        { type: "permission", action: "distribute", assignee: agent, constraints: [CONSTRAINT] },
      ],
    };
    const leaf: OdrlPolicy = {
      id: "https://agent.example/policies/leaf",
      type: "Agreement",
      assigner: agent,
      assignee: subagent,
      delegatedUnder: root.id,
      permissions: [{ type: "permission", action: "distribute", constraints: [CONSTRAINT] }],
    };
    const request = {
      ...REQUEST,
      agent: subagent,
      attributes: { recipient: MEMBER, "fulfilled:inform": true },
    };
    expect(
      evaluateDelegated([root, leaf], request, { ...OPTIONS, requireDuties: true }).decision,
    ).toBe("permit");
    expect(evaluateDelegated([root, leaf], request).decision).toBe("deny");
    expect(
      evaluateDelegated(
        [root, leaf],
        { ...request, attributes: { ...request.attributes, recipient: OUTSIDER } },
        OPTIONS,
      ).decision,
    ).toBe("deny");
    const prohibited = {
      ...root,
      prohibitions: [
        { type: "prohibition" as const, action: "distribute" as const, constraints: [CONSTRAINT] },
      ],
    };
    expect(evaluateDelegated([prohibited, leaf], request, OPTIONS).decision).toBe("deny");
  });
});

describe("recipient isPartOf decision records", () => {
  it.each([
    "permission",
    "prohibition",
  ] as const)("records only the satisfied anonymous %s sibling", (type) => {
    const rules = [OTHER_COLLECTION, COLLECTION].map((rightOperand) => ({
      type,
      action: "distribute" as const,
      constraints: [{ ...CONSTRAINT, rightOperand }],
    }));
    const policy: OdrlPolicy = {
      id: POLICY.id,
      ...(type === "permission" ? { permissions: rules } : { prohibitions: rules }),
    };
    const record = recordEvaluation(
      "https://alice.example/records/decision",
      policy,
      REQUEST,
      OPTIONS,
    );
    expect(record.result.decision).toBe(type === "permission" ? "permit" : "deny");
    const input = {
      id: "https://alice.example/records/decision",
      policy,
      request: REQUEST,
      result: record.result,
      evaluatedAt: NOW,
      resolvePartyCollection: OPTIONS.resolvePartyCollection,
    };
    expect(decisionRecordJsonLd(input)).toEqual(record.jsonld);
    expect(record.jsonld.decidingRule).toEqual([
      expect.objectContaining({
        constraint: [
          {
            leftOperand: { "@id": `${ODRL}recipient` },
            operator: { "@id": `${ODRL}isPartOf` },
            rightOperand: { "@id": COLLECTION },
          },
        ],
      }),
    ]);
    for (const quads of [record.quads, decisionRecord(input)]) {
      const dataset = new DatasetWrapper(new Store(quads) as unknown as DatasetCore, DataFactory);
      const cls = type === "permission" ? ODRL_PERMISSION_CLASS : `${ODRL}Prohibition`;
      const deciding = [...dataset.instancesOf(cls, RuleNode)];
      expect(deciding).toHaveLength(1);
      const constraints = [...required(deciding[0]).constraints];
      const constraint = required(constraints[0]);
      expect([...constraint.rightOperands].map((term) => [term.termType, term.value])).toEqual([
        ["NamedNode", COLLECTION],
      ]);
      expect([...constraint.operators].map((term) => term.value)).toEqual([`${ODRL}isPartOf`]);
    }
  });
});
