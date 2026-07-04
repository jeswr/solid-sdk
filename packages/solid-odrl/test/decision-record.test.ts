// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Exhaustive unit tests for the G9 decision-record emitter
// (src/decision-record.ts). Security-critical (authz explainability): a permit /
// deny / conflict / notApplicable / duty outcome must be recorded faithfully with
// the DECIDING rules + constraints named, and a hostile IRI in any field must be
// neutralised (no triple injection) IDENTICALLY on the RDF and JSON-LD paths.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import {
  type DecisionRecordInput,
  decisionRecord,
  decisionRecordJsonLd,
  recordEvaluation,
} from "../src/decision-record.js";
import { evaluate } from "../src/evaluate.js";
import { escapeIri } from "../src/iri.js";
import { serialize } from "../src/serialize.js";
import type { EvaluationResult, OdrlPolicy, RequestContext } from "../src/types.js";
import {
  ACTION_IRI,
  LEFT_OPERAND_IRI,
  ODRL_ACTION,
  ODRL_ASSIGNEE,
  ODRL_CONSTRAINT,
  ODRL_DUTY_CLASS,
  ODRL_LEFT_OPERAND,
  ODRL_OPERATOR,
  ODRL_PERMISSION_CLASS,
  ODRL_PROHIBITION_CLASS,
  ODRL_RIGHT_OPERAND,
  ODRL_TARGET,
  ODRLD_ACTIVE_DUTY,
  ODRLD_CONFLICT,
  ODRLD_DECIDING_RULE,
  ODRLD_DECISION,
  ODRLD_DECISION_RECORD_CLASS,
  ODRLD_EVALUATED_POLICY,
  ODRLD_FULFILLED,
  ODRLD_ON_DUTY,
  ODRLD_REASON,
  ODRLD_REQUEST_ACTION,
  ODRLD_REQUEST_AGENT,
  ODRLD_REQUEST_PURPOSE,
  ODRLD_REQUEST_TARGET,
  ODRLD_RULE_KIND,
  OPERATOR_IRI,
  PROV_ENDED_AT_TIME,
  RDF_TYPE,
} from "../src/vocab.js";

const REC = "https://alice.example/records/d1#decision";
const POLICY_ID = "https://alice.example/policies/p1";
const AGENT = "https://bob.example/profile/card#me";
const TARGET = "https://alice.example/data/records.ttl";
const PURPOSE = "https://w3id.org/dpv#ResearchAndDevelopment";
const AT = new Date("2026-07-04T10:00:00Z");

/** Materialise a triple as `s p o` for easy `toContain` assertions. */
function triples(quads: readonly Quad[]): string[] {
  return quads.map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`);
}

/** Literal object value for (subject, predicate), or undefined. */
function literal(quads: readonly Quad[], subject: string, predicate: string): string | undefined {
  return quads.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object
    .value;
}

/** The blank-node ids linked from `subject` via `predicate`. */
function children(quads: readonly Quad[], subject: string, predicate: string): string[] {
  return quads
    .filter((q) => q.subject.value === subject && q.predicate.value === predicate)
    .map((q) => q.object.value);
}

function baseInput(overrides: Partial<DecisionRecordInput> = {}): DecisionRecordInput {
  const policy: OdrlPolicy = { id: POLICY_ID };
  const request: RequestContext = { agent: AGENT, action: "read", target: TARGET };
  const result: EvaluationResult = {
    decision: "notApplicable",
    reason: "No permission or prohibition matches the request.",
    matchedPermissions: [],
    matchedProhibitions: [],
    duties: [],
    conflict: false,
  };
  return { id: REC, policy, request, result, evaluatedAt: AT, ...overrides };
}

describe("decisionRecord — permit path", () => {
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: PURPOSE },
  };

  it("records a matched permission, its deciding constraint, and the request fields (no conflict)", () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const t = triples(quads);

    expect(t).toContain(`${REC} ${RDF_TYPE} ${ODRLD_DECISION_RECORD_CLASS}`);
    expect(t).toContain(`${REC} ${ODRLD_EVALUATED_POLICY} ${POLICY_ID}`);
    expect(t).toContain(`${REC} ${ODRLD_REQUEST_AGENT} ${AGENT}`);
    expect(t).toContain(`${REC} ${ODRLD_REQUEST_ACTION} ${ACTION_IRI.read}`);
    expect(t).toContain(`${REC} ${ODRLD_REQUEST_TARGET} ${TARGET}`);
    expect(t).toContain(`${REC} ${ODRLD_REQUEST_PURPOSE} ${PURPOSE}`);
    expect(literal(quads, REC, ODRLD_DECISION)).toBe("permit");
    expect(literal(quads, REC, ODRLD_REASON)).toBe(result.reason);
    expect(literal(quads, REC, PROV_ENDED_AT_TIME)).toBe(AT.toISOString());
    // No conflict flag on a clean permit.
    expect(quads.some((q) => q.predicate.value === ODRLD_CONFLICT)).toBe(false);

    // Exactly one deciding-rule node, a Permission, carrying the deciding constraint.
    const ruleNodes = children(quads, REC, ODRLD_DECIDING_RULE);
    expect(ruleNodes).toHaveLength(1);
    const rule = ruleNodes[0];
    const rt = triples(quads.filter((q) => q.subject.value === rule));
    expect(rt).toContain(`${rule} ${RDF_TYPE} ${ODRL_PERMISSION_CLASS}`);
    expect(rt).toContain(`${rule} ${ODRLD_RULE_KIND} permission`);
    expect(rt).toContain(`${rule} ${ODRL_ACTION} ${ACTION_IRI.read}`);
    expect(rt).toContain(`${rule} ${ODRL_TARGET} ${TARGET}`);
    expect(rt).toContain(`${rule} ${ODRL_ASSIGNEE} ${AGENT}`);

    // The deciding constraint (purpose eq PURPOSE) is named under the rule node.
    const cNodes = children(quads, rule, ODRL_CONSTRAINT);
    expect(cNodes).toHaveLength(1);
    const ct = triples(quads.filter((q) => q.subject.value === cNodes[0]));
    expect(ct).toContain(`${cNodes[0]} ${ODRL_LEFT_OPERAND} ${LEFT_OPERAND_IRI.purpose}`);
    expect(ct).toContain(`${cNodes[0]} ${ODRL_OPERATOR} ${OPERATOR_IRI.eq}`);
    expect(ct).toContain(`${cNodes[0]} ${ODRL_RIGHT_OPERAND} ${PURPOSE}`);
  });

  it("round-trips through parseRdf as valid RDF with the same triple count", async () => {
    const result = evaluate(policy, request);
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const ttl = await serialize(quads);
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
  });
});

describe("decisionRecord — multi-valued request purpose", () => {
  // `attributes.purpose` may be an ARRAY (the evaluator satisfies an isAnyOf purpose
  // constraint from a multi-valued request attribute). ALL asserted string purposes
  // must be recorded, on both paths (roborev Medium).
  const PurposeX = "https://w3id.org/dpv#ResearchAndDevelopment";
  const PurposeY = "https://w3id.org/dpv#AcademicResearch";
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [
          { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PurposeX, PURPOSE] },
        ],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: [PurposeX, PurposeY] },
  };

  it("records every asserted purpose IRI (RDF path)", () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const purposes = children(quads, REC, ODRLD_REQUEST_PURPOSE);
    expect(purposes).toContain(PurposeX);
    expect(purposes).toContain(PurposeY);
    expect(purposes).toHaveLength(2);
  });

  it("records every asserted purpose IRI (JSON-LD path)", async () => {
    const result = evaluate(policy, request);
    const doc = decisionRecordJsonLd({ id: REC, policy, request, result, evaluatedAt: AT });
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const purposes = [...dataset]
      .filter((q) => q.predicate.value === ODRLD_REQUEST_PURPOSE)
      .map((q) => q.object.value);
    expect(purposes).toContain(PurposeX);
    expect(purposes).toContain(PurposeY);
    expect(purposes).toHaveLength(2);
  });
});

describe("decisionRecord — deny path (matched prohibition with a deciding constraint)", () => {
  it("names the deciding constraint (leftOperand/operator/rightOperand) of the prohibition", () => {
    const policy: OdrlPolicy = {
      id: POLICY_ID,
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          target: TARGET,
          constraints: [{ leftOperand: "count", operator: "gt", rightOperand: 5 }],
        },
      ],
    };
    // count=10 > 5 → the prohibition matches → deny.
    const request: RequestContext = {
      agent: AGENT,
      action: "read",
      target: TARGET,
      attributes: { count: 10 },
    };
    const result = evaluate(policy, request);
    expect(result.decision).toBe("deny");

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    expect(literal(quads, REC, ODRLD_DECISION)).toBe("deny");
    const ruleNodes = children(quads, REC, ODRLD_DECIDING_RULE);
    expect(ruleNodes).toHaveLength(1);
    const rule = ruleNodes[0];
    const rt = triples(quads.filter((q) => q.subject.value === rule));
    expect(rt).toContain(`${rule} ${RDF_TYPE} ${ODRL_PROHIBITION_CLASS}`);
    expect(rt).toContain(`${rule} ${ODRLD_RULE_KIND} prohibition`);

    const cNodes = children(quads, rule, ODRL_CONSTRAINT);
    expect(cNodes).toHaveLength(1);
    const ct = triples(quads.filter((q) => q.subject.value === cNodes[0]));
    expect(ct).toContain(`${cNodes[0]} ${ODRL_LEFT_OPERAND} ${LEFT_OPERAND_IRI.count}`);
    expect(ct).toContain(`${cNodes[0]} ${ODRL_OPERATOR} ${OPERATOR_IRI.gt}`);
    // The right-operand 5 is a typed integer literal.
    const right = quads.find(
      (q) => q.subject.value === cNodes[0] && q.predicate.value === ODRL_RIGHT_OPERAND,
    );
    expect(right?.object.value).toBe("5");
  });
});

describe("decisionRecord — two SATISFIED anonymous shape-identical siblings (no constraint union)", () => {
  // Two anonymous permissions share (action, target, assignee) but carry DIFFERENT
  // constraints, and BOTH are satisfied — so `evaluate` returns two identical
  // (constraint-free) descriptors. Positional 1:1 assignment must give each
  // deciding-rule node exactly ONE rule's constraints, never the union (roborev
  // Medium).
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }],
      },
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "count", operator: "lteq", rightOperand: 5 }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: PURPOSE, count: 3 },
  };

  /** The sorted leftOperand IRIs of the constraints under one deciding-rule node. */
  function leftsOf(quads: readonly Quad[], ruleNode: string): string[] {
    return children(quads, ruleNode, ODRL_CONSTRAINT)
      .flatMap((c) =>
        quads
          .filter((q) => q.subject.value === c && q.predicate.value === ODRL_LEFT_OPERAND)
          .map((q) => q.object.value),
      )
      .sort();
  }

  it("emits each rule's own single constraint — never the union — on the RDF path", () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    expect(result.matchedPermissions).toHaveLength(2);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const ruleNodes = children(quads, REC, ODRLD_DECIDING_RULE);
    expect(ruleNodes).toHaveLength(2);

    // Each node carries exactly ONE constraint (no union), and across both nodes the
    // two distinct constraints appear exactly once each.
    const perNode = ruleNodes.map((n) => leftsOf(quads, n)).sort();
    expect(perNode).toEqual([[LEFT_OPERAND_IRI.count], [LEFT_OPERAND_IRI.purpose]]);
    // Neither node has BOTH lefts (the union bug).
    for (const lefts of perNode) {
      expect(lefts).toHaveLength(1);
    }
  });

  it("emits each rule's own single constraint on the JSON-LD path", async () => {
    const result = evaluate(policy, request);
    const doc = decisionRecordJsonLd({ id: REC, policy, request, result, evaluatedAt: AT });
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const q = [...dataset];
    const ruleNodes = q
      .filter((x) => x.predicate.value === ODRLD_DECIDING_RULE)
      .map((x) => x.object.value);
    expect(ruleNodes).toHaveLength(2);
    const perNode = ruleNodes.map((n) => leftsOf(q, n)).sort();
    expect(perNode).toEqual([[LEFT_OPERAND_IRI.count], [LEFT_OPERAND_IRI.purpose]]);
  });
});

describe("decisionRecord — conflict path", () => {
  it("records odrld:conflict true and BOTH deciding rules", () => {
    const policy: OdrlPolicy = {
      id: POLICY_ID,
      // default conflict strategy = prohibit → deny wins, but conflict=true.
      permissions: [{ type: "permission", action: "read", target: TARGET, assignee: AGENT }],
      prohibitions: [{ type: "prohibition", action: "read", target: TARGET, assignee: AGENT }],
    };
    const request: RequestContext = { agent: AGENT, action: "read", target: TARGET };
    const result = evaluate(policy, request);
    expect(result.conflict).toBe(true);
    expect(result.decision).toBe("deny");

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    expect(literal(quads, REC, ODRLD_CONFLICT)).toBe("true");
    const conflictQuad = quads.find((q) => q.predicate.value === ODRLD_CONFLICT);
    expect(conflictQuad?.object.value).toBe("true");
    expect((conflictQuad?.object as { datatype?: { value: string } }).datatype?.value).toBe(
      "http://www.w3.org/2001/XMLSchema#boolean",
    );

    // Both a Permission and a Prohibition deciding-rule node are present.
    const ruleNodes = children(quads, REC, ODRLD_DECIDING_RULE);
    expect(ruleNodes).toHaveLength(2);
    const kinds = ruleNodes.map((n) => literal(quads, n, ODRLD_RULE_KIND)).sort();
    expect(kinds).toEqual(["permission", "prohibition"]);
  });
});

describe("decisionRecord — duties (fulfilled + unfulfilled)", () => {
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        duties: [{ action: "attribute", target: AGENT }],
      },
    ],
  };

  it("records an UNFULFILLED active duty (fulfilled=false) on a bare permit", () => {
    const request: RequestContext = { agent: AGENT, action: "read", target: TARGET };
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    expect(result.duties).toHaveLength(1);
    expect(result.duties[0].fulfilled).toBe(false);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const dutyNodes = children(quads, REC, ODRLD_ACTIVE_DUTY);
    expect(dutyNodes).toHaveLength(1);
    const duty = dutyNodes[0];
    const dt = triples(quads.filter((q) => q.subject.value === duty));
    expect(dt).toContain(`${duty} ${RDF_TYPE} ${ODRL_DUTY_CLASS}`);
    expect(dt).toContain(`${duty} ${ODRL_ACTION} ${ACTION_IRI.attribute}`);
    expect(dt).toContain(`${duty} ${ODRL_TARGET} ${AGENT}`);
    expect(literal(quads, duty, ODRLD_FULFILLED)).toBe("false");
  });

  it("records a FULFILLED active duty (fulfilled=true) when the context discharges it", () => {
    const request: RequestContext = {
      agent: AGENT,
      action: "read",
      target: TARGET,
      attributes: { "fulfilled:attribute": true },
    };
    const result = evaluate(policy, request);
    expect(result.duties[0].fulfilled).toBe(true);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const dutyNodes = children(quads, REC, ODRLD_ACTIVE_DUTY);
    expect(dutyNodes).toHaveLength(1);
    expect(literal(quads, dutyNodes[0], ODRLD_FULFILLED)).toBe("true");
  });

  it("puts the per-evaluation fulfilled flag on a RECORD-SCOPED node, not the stable duty IRI", () => {
    // The active-duty node must be a blank node linking to the policy duty IRI via
    // odrld:onDuty, so two records for the same duty with DIFFERENT fulfilment can be
    // merged without asserting both true and false on one node (roborev Medium).
    const DutyId = "urn:example:dutyA";
    const dutyPolicy: OdrlPolicy = {
      id: POLICY_ID,
      permissions: [
        {
          type: "permission",
          action: "read",
          target: TARGET,
          assignee: AGENT,
          duties: [{ id: DutyId, action: "attribute", target: AGENT }],
        },
      ],
    };
    const reqUnfulfilled: RequestContext = { agent: AGENT, action: "read", target: TARGET };
    const reqFulfilled: RequestContext = {
      agent: AGENT,
      action: "read",
      target: TARGET,
      attributes: { "fulfilled:attribute": true },
    };
    const r1 = decisionRecord({
      id: REC,
      policy: dutyPolicy,
      request: reqUnfulfilled,
      result: evaluate(dutyPolicy, reqUnfulfilled),
      evaluatedAt: AT,
    });
    const r2 = decisionRecord({
      id: REC,
      policy: dutyPolicy,
      request: reqFulfilled,
      result: evaluate(dutyPolicy, reqFulfilled),
      evaluatedAt: AT,
    });

    for (const quads of [r1, r2]) {
      const dutyNode = children(quads, REC, ODRLD_ACTIVE_DUTY)[0];
      // The node is a blank node (record-scoped), NOT the stable duty IRI.
      const link = quads.find(
        (q) => q.predicate.value === ODRLD_ACTIVE_DUTY && q.object.value === dutyNode,
      );
      expect(link?.object.termType).toBe("BlankNode");
      // It links to the stable duty IRI via odrld:onDuty.
      expect(literal(quads, dutyNode, ODRLD_ON_DUTY)).toBe(DutyId);
      // The stable duty IRI itself carries NO per-evaluation fulfilled triple.
      expect(
        quads.some((q) => q.subject.value === DutyId && q.predicate.value === ODRLD_FULFILLED),
      ).toBe(false);
    }
    // r1 records fulfilled=false, r2 fulfilled=true — on DISTINCT record-scoped nodes,
    // so a merged audit graph never asserts both on the duty IRI.
    expect(literal(r1, children(r1, REC, ODRLD_ACTIVE_DUTY)[0], ODRLD_FULFILLED)).toBe("false");
    expect(literal(r2, children(r2, REC, ODRLD_ACTIVE_DUTY)[0], ODRLD_FULFILLED)).toBe("true");
  });
});

describe("decisionRecord — notApplicable path", () => {
  it("records decision=notApplicable with no deciding rules and no duties", () => {
    const input = baseInput();
    const quads = decisionRecord(input);
    expect(literal(quads, REC, ODRLD_DECISION)).toBe("notApplicable");
    expect(children(quads, REC, ODRLD_DECIDING_RULE)).toHaveLength(0);
    expect(children(quads, REC, ODRLD_ACTIVE_DUTY)).toHaveLength(0);
    expect(quads.some((q) => q.predicate.value === ODRLD_CONFLICT)).toBe(false);
  });
});

describe("decisionRecord — inherited-assignee constraint location", () => {
  it("locates the deciding constraint of a rule that inherits the policy-level assignee", () => {
    const policy: OdrlPolicy = {
      id: POLICY_ID,
      assignee: AGENT, // policy-level; the rule omits its own.
      permissions: [
        {
          type: "permission",
          action: "read",
          target: TARGET,
          constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }],
        },
      ],
    };
    const request: RequestContext = {
      agent: AGENT,
      action: "read",
      target: TARGET,
      attributes: { purpose: PURPOSE },
    };
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    // The DecisionRule carries the INHERITED assignee.
    expect(result.matchedPermissions[0].assignee).toBe(AGENT);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const rule = children(quads, REC, ODRLD_DECIDING_RULE)[0];
    // The constraint was located despite the rule inheriting its assignee.
    const cNodes = children(quads, rule, ODRL_CONSTRAINT);
    expect(cNodes).toHaveLength(1);
    expect(triples(quads.filter((q) => q.subject.value === cNodes[0]))).toContain(
      `${cNodes[0]} ${ODRL_RIGHT_OPERAND} ${PURPOSE}`,
    );
  });
});

describe("decisionRecord — does NOT attribute a non-deciding sibling's constraints", () => {
  // Two permissions share (action, target, assignee) but differ in their
  // constraints; only permission A's constraint (purpose eq X) is satisfied, so
  // `evaluate` matched only A. The record must name A's deciding constraint and NOT
  // B's (purpose eq Y) — a descriptor-ambiguity regression (roborev Medium).
  const PurposeA = "https://w3id.org/dpv#ResearchAndDevelopment";
  const PurposeB = "https://w3id.org/dpv#Marketing";
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PurposeA }],
      },
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PurposeB }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: PurposeA },
  };

  it("emits only the matched rule's constraint, not the sibling's", () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    // evaluate matched exactly ONE permission (A) — B's constraint failed.
    expect(result.matchedPermissions).toHaveLength(1);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const rightOperands = quads
      .filter((q) => q.predicate.value === ODRL_RIGHT_OPERAND)
      .map((q) => q.object.value);
    expect(rightOperands).toContain(PurposeA);
    // The non-deciding sibling's constraint value must NOT be recorded as deciding.
    expect(rightOperands).not.toContain(PurposeB);
  });

  it("JSON-LD path likewise omits the non-deciding sibling's constraint", async () => {
    const result = evaluate(policy, request);
    const doc = decisionRecordJsonLd({ id: REC, policy, request, result, evaluatedAt: AT });
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const rightOperands = [...dataset]
      .filter((q) => q.predicate.value === ODRL_RIGHT_OPERAND)
      .map((q) => q.object.value);
    expect(rightOperands).toContain(PurposeA);
    expect(rightOperands).not.toContain(PurposeB);
  });
});

describe("decisionRecord — identified vs anonymous rules (id is part of identity)", () => {
  // Rule A is identified; rule B is an anonymous shape-alike with a DIFFERENT
  // constraint. Both match the request, so `evaluate` returns both. A's deciding
  // node must record ONLY A's constraint and B's ONLY B's — a mixed
  // identified/anonymous misattribution regression (roborev Medium) — and A's node
  // must carry the stable rule IRI as its subject/@id (roborev Low).
  const RuleA = "urn:example:ruleA";
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        id: RuleA,
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }],
      },
      {
        // anonymous, shape-identical, DIFFERENT constraint.
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "count", operator: "lteq", rightOperand: 5 }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: PURPOSE, count: 3 },
  };

  /** The leftOperand IRIs of the constraints hanging off `ruleNode`. */
  function constraintLefts(quads: readonly Quad[], ruleNode: string): string[] {
    return children(quads, ruleNode, ODRL_CONSTRAINT).flatMap((c) =>
      quads
        .filter((q) => q.subject.value === c && q.predicate.value === ODRL_LEFT_OPERAND)
        .map((q) => q.object.value),
    );
  }

  it("records each rule's OWN constraint only, and links the identified rule by its IRI", () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    expect(result.matchedPermissions).toHaveLength(2);

    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const ruleNodes = children(quads, REC, ODRLD_DECIDING_RULE);
    expect(ruleNodes).toHaveLength(2);

    // The identified rule's node IS the rule IRI (stable link), not a blank node.
    expect(ruleNodes).toContain(RuleA);
    const anonNode = ruleNodes.find((n) => n !== RuleA);
    expect(anonNode).toBeDefined();
    const anonQuad = quads.find(
      (q) => q.predicate.value === ODRLD_DECIDING_RULE && q.object.value === anonNode,
    );
    expect(anonQuad?.object.termType).toBe("BlankNode");

    // A's node carries ONLY the purpose constraint; B's node ONLY the count one.
    expect(constraintLefts(quads, RuleA)).toEqual([LEFT_OPERAND_IRI.purpose]);
    expect(constraintLefts(quads, anonNode as string)).toEqual([LEFT_OPERAND_IRI.count]);
  });

  it("JSON-LD preserves the identified rule's @id and its own constraint only", async () => {
    const result = evaluate(policy, request);
    const doc = decisionRecordJsonLd({ id: REC, policy, request, result, evaluatedAt: AT });
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const q = [...dataset];
    // The identified rule IRI appears as a decidingRule object.
    const decidesA = q.some(
      (x) => x.predicate.value === ODRLD_DECIDING_RULE && x.object.value === RuleA,
    );
    expect(decidesA).toBe(true);
    // Its only constraint leftOperand is purpose (count is not attributed to it).
    const aConstraintNodes = q
      .filter((x) => x.subject.value === RuleA && x.predicate.value === ODRL_CONSTRAINT)
      .map((x) => x.object.value);
    const aLefts = aConstraintNodes.flatMap((c) =>
      q
        .filter((x) => x.subject.value === c && x.predicate.value === ODRL_LEFT_OPERAND)
        .map((x) => x.object.value),
    );
    expect(aLefts).toEqual([LEFT_OPERAND_IRI.purpose]);
  });
});

describe("decisionRecord — dateTime-sensitive constraint is never OMITTED on a clock mismatch", () => {
  // An anonymous permission with a dateTime window. `evaluate` matched it at a `now`
  // INSIDE the window; if the record is built with an `evaluatedAt` OUTSIDE the
  // window (against the contract), the time-sensitive re-check would exclude the
  // rule — but the resolver must FALL BACK to the shape-match so the real deciding
  // constraint is never dropped from the audit trail (roborev Medium).
  const WindowEnd = "2026-07-04T12:00:00Z";
  const Inside = new Date("2026-07-04T10:00:00Z");
  const Outside = new Date("2026-07-04T14:00:00Z");
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: WindowEnd }],
      },
    ],
  };
  const request: RequestContext = { agent: AGENT, action: "read", target: TARGET };

  function dateTimeConstraintPresent(quads: readonly Quad[]): boolean {
    const rule = children(quads, REC, ODRLD_DECIDING_RULE)[0];
    return children(quads, rule, ODRL_CONSTRAINT).some((c) =>
      quads.some(
        (q) =>
          q.subject.value === c &&
          q.predicate.value === ODRL_LEFT_OPERAND &&
          q.object.value === LEFT_OPERAND_IRI.dateTime,
      ),
    );
  }

  it("records the deciding dateTime constraint with the matching evaluatedAt (precise path)", () => {
    const result = evaluate(policy, request, { now: Inside });
    expect(result.decision).toBe("permit");
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: Inside });
    expect(dateTimeConstraintPresent(quads)).toBe(true);
  });

  it("still records the deciding dateTime constraint when evaluatedAt is outside the window (fallback)", () => {
    const result = evaluate(policy, request, { now: Inside });
    expect(result.decision).toBe("permit");
    // evaluatedAt mismatched (after the window) — re-check would exclude the rule.
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: Outside });
    // The real deciding constraint must NOT be omitted.
    expect(dateTimeConstraintPresent(quads)).toBe(true);
    expect(children(quads, REC, ODRLD_DECIDING_RULE)).toHaveLength(1);
  });
});

describe("decisionRecord — a hostile IRI-valued constraint operand is escaped, not thrown", () => {
  // The policy path REJECTS a would-mutate IRI operand (fail-closed for evaluation
  // identity). A decision record is descriptive, so it must NEUTRALISE (escape) such
  // an operand rather than throw — an audit trail must always be producible
  // (roborev Medium).
  const hostilePurpose =
    "https://evil.example/p> <https://victim.example/s> <https://victim.example/p> <https://victim.example/o> .\n<https://evil.example/p";
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: hostilePurpose }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: hostilePurpose },
  };

  it("does not throw and escapes the operand (no triple injection) — RDF path", async () => {
    const result = evaluate(policy, request);
    expect(result.decision).toBe("permit");
    // The whole point of the fix: this call must NOT throw OdrlSerializationError.
    const quads = decisionRecord({ id: REC, policy, request, result, evaluatedAt: AT });
    const ttl = await serialize(quads);
    expect(ttl).toContain("%3E");
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
    for (const q of reparsed) {
      expect(q.subject.value).not.toBe("https://victim.example/s");
      expect(q.object.value).not.toBe("https://victim.example/o");
    }
    // The recorded operand is the escaped form (breakout-proof).
    const right = quads.find((q) => q.predicate.value === ODRL_RIGHT_OPERAND);
    expect(right?.object.value).toBe(escapeIri(hostilePurpose));
  });

  it("does not throw and injects nothing — JSON-LD path", async () => {
    const result = evaluate(policy, request);
    const doc = decisionRecordJsonLd({ id: REC, policy, request, result, evaluatedAt: AT });
    const json = JSON.stringify(doc);
    expect(json).not.toContain("p> <https://victim.example/s");
    const dataset = await parseRdf(json, "application/ld+json");
    for (const q of dataset) {
      expect(q.subject.value).not.toBe("https://victim.example/s");
      expect(q.object.value).not.toBe("https://victim.example/o");
    }
  });
});

describe("recordEvaluation — closed-loop, exact-clock record", () => {
  // Two anonymous shape-identical siblings differing ONLY in a dateTime constraint
  // (mutually exclusive by time). recordEvaluation owns the clock, so the record
  // attributes the deciding constraint to the sibling that actually matched at that
  // instant — no clock gap between evaluate and record (roborev-suggested wrapper).
  const T1 = "2026-07-04T12:00:00Z";
  const Now = new Date("2026-07-04T10:00:00Z"); // before T1 → only rule A matches.
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: T1 }],
      },
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "dateTime", operator: "gt", rightOperand: T1 }],
      },
    ],
  };
  const request: RequestContext = { agent: AGENT, action: "read", target: TARGET };

  it("evaluates + emits with a consistent clock and the right deciding constraint", () => {
    const { result, quads, jsonld } = recordEvaluation(REC, policy, request, { now: Now });
    expect(result.decision).toBe("permit");
    // Only rule A (dateTime lteq T1) matched at NOW.
    expect(result.matchedPermissions).toHaveLength(1);

    // The record's evaluatedAt is exactly the captured clock.
    expect(literal(quads, REC, PROV_ENDED_AT_TIME)).toBe(Now.toISOString());
    // The single deciding-rule node names A's constraint (lteq T1), not B's (gt T1).
    const rule = children(quads, REC, ODRLD_DECIDING_RULE)[0];
    const cNode = children(quads, rule, ODRL_CONSTRAINT)[0];
    expect(literal(quads, cNode, ODRL_OPERATOR)).toBe(OPERATOR_IRI.lteq);
    expect(literal(quads, cNode, ODRL_RIGHT_OPERAND)).toBe(T1);

    // JSON-LD is emitted for the same record.
    expect(jsonld["@type"]).toBe("odrld:DecisionRecord");
  });
});

describe("decisionRecordJsonLd — round-trip + parity", () => {
  const policy: OdrlPolicy = {
    id: POLICY_ID,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: TARGET,
        assignee: AGENT,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }],
      },
    ],
  };
  const request: RequestContext = {
    agent: AGENT,
    action: "read",
    target: TARGET,
    attributes: { purpose: PURPOSE },
  };

  it("produces the same triple shape as the RDF path", async () => {
    const result = evaluate(policy, request);
    const input = { id: REC, policy, request, result, evaluatedAt: AT };
    const doc = decisionRecordJsonLd(input);
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const jt = [...dataset].map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`);

    expect(jt).toContain(`${REC} ${RDF_TYPE} ${ODRLD_DECISION_RECORD_CLASS}`);
    expect(jt).toContain(`${REC} ${ODRLD_EVALUATED_POLICY} ${POLICY_ID}`);
    expect(jt).toContain(`${REC} ${ODRLD_REQUEST_ACTION} ${ACTION_IRI.read}`);
    expect(jt).toContain(`${REC} ${ODRLD_REQUEST_PURPOSE} ${PURPOSE}`);

    // Same triple COUNT as the RDF path.
    const rdfQuads = decisionRecord(input);
    expect(dataset.size).toBe(rdfQuads.length);
  });
});

describe("decisionRecord — IRI-injection safety (RDF + JSON-LD parity)", () => {
  // A hostile policy.id / request.target with a `>`-breakout payload must be
  // escaped (percent-encoded) so it stays inside ONE object IRI and mints no extra
  // triples — on BOTH serialisations.
  const hostileTail =
    "> <https://victim.example/s> <https://victim.example/p> <https://victim.example/o> .\n<https://evil.example/x";
  const hostilePolicyId = `https://evil.example/policy${hostileTail}`;
  const hostileTarget = `https://evil.example/target${hostileTail}`;

  function hostileInput(): DecisionRecordInput {
    const policy: OdrlPolicy = { id: hostilePolicyId };
    const request: RequestContext = { agent: AGENT, action: "read", target: hostileTarget };
    const result: EvaluationResult = {
      decision: "notApplicable",
      reason: "No permission or prohibition matches the request.",
      matchedPermissions: [],
      matchedProhibitions: [],
      duties: [],
      conflict: false,
    };
    return { id: REC, policy, request, result, evaluatedAt: AT };
  }

  it("escapes the hostile IRIs in the RDF path — no injected triples", async () => {
    const quads = decisionRecord(hostileInput());
    const ttl = await serialize(quads);
    expect(ttl).toContain("%3E"); // the `>` breakout survives only percent-escaped.
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
    for (const q of reparsed) {
      expect(q.subject.value).not.toBe("https://victim.example/s");
      expect(q.object.value).not.toBe("https://victim.example/o");
    }
    // The escaped value is byte-identical between raw escapeIri and the emitted term.
    const polQuad = quads.find((q) => q.predicate.value === ODRLD_EVALUATED_POLICY);
    expect(polQuad?.object.value).toBe(escapeIri(hostilePolicyId));
  });

  it("escapes the hostile IRIs IDENTICALLY in the JSON-LD path — no injected triples", async () => {
    const doc = decisionRecordJsonLd(hostileInput());
    const json = JSON.stringify(doc);
    // No raw breakout survives in the serialised JSON.
    expect(json).not.toContain("target> <https://victim.example/s");
    const dataset = await parseRdf(json, "application/ld+json");
    for (const q of dataset) {
      expect(q.subject.value).not.toBe("https://victim.example/s");
      expect(q.object.value).not.toBe("https://victim.example/o");
      if (q.predicate.value === ODRLD_EVALUATED_POLICY) {
        expect(q.object.value).toBe(escapeIri(hostilePolicyId));
      }
      if (q.predicate.value === ODRLD_REQUEST_TARGET) {
        expect(q.object.value).toBe(escapeIri(hostileTarget));
      }
    }
  });
});
