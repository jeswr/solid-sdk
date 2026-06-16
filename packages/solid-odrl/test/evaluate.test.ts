// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Exhaustive tests for the client-side ODRL evaluator: permit / deny /
// notApplicable, constraint satisfaction across every operator + left-operand,
// duty handling (advisory vs requireDuties), conflict resolution per ODRL
// semantics (perm / prohibit / invalid / default), action-implication (odrl:use
// umbrella), target/assignee matching, and fail-closed on missing context.

import { describe, expect, it } from "vitest";
import { constraintSatisfied, evaluate } from "../src/evaluate.js";
import type { OdrlConstraint, OdrlPolicy, RequestContext } from "../src/types.js";

const OWNER = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const RES = "https://alice.example/notes/private.ttl";
const OTHER = "https://alice.example/notes/other.ttl";
const NOW = new Date("2026-06-16T12:00:00Z");

describe("basic permit / deny / notApplicable", () => {
  it("permits when only a matching permission exists", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    };
    const r = evaluate(policy, { agent: BOB, action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.matchedPermissions.length).toBe(1);
    expect(r.matchedProhibitions.length).toBe(0);
  });

  it("denies when only a matching prohibition exists", () => {
    const policy: OdrlPolicy = {
      id: "p",
      prohibitions: [{ type: "prohibition", action: "read", target: RES }],
    };
    const r = evaluate(policy, { agent: BOB, action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("returns notApplicable when no rule matches the request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    };
    // Different agent, different resource → no match.
    const r = evaluate(policy, { agent: CAROL, action: "read", target: OTHER }, { now: NOW });
    expect(r.decision).toBe("notApplicable");
    expect(r.matchedPermissions.length).toBe(0);
  });

  it("does not match a permission for a different agent", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    };
    const r = evaluate(policy, { agent: CAROL, action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("notApplicable");
  });

  it("does not match a permission for a different target", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES }],
    };
    const r = evaluate(policy, { action: "read", target: OTHER }, { now: NOW });
    expect(r.decision).toBe("notApplicable");
  });

  it("a permission with no target/assignee applies to any request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read" }],
    };
    const r = evaluate(policy, { agent: CAROL, action: "read", target: OTHER }, { now: NOW });
    expect(r.decision).toBe("permit");
  });
});

describe("policy-level assigner/assignee inheritance (roborev High fix)", () => {
  it("a rule inherits the policy-level assignee when it omits its own", () => {
    const policy: OdrlPolicy = {
      id: "p",
      assignee: BOB,
      permissions: [{ type: "permission", action: "read", target: RES }], // no rule-level assignee
    };
    // BOB (the inherited assignee) is permitted.
    expect(
      evaluate(policy, { agent: BOB, action: "read", target: RES }, { now: NOW }).decision,
    ).toBe("permit");
    // A DIFFERENT agent must NOT be permitted (the bug: it used to permit anyone).
    expect(
      evaluate(policy, { agent: CAROL, action: "read", target: RES }, { now: NOW }).decision,
    ).toBe("notApplicable");
  });

  it("a rule-level assignee overrides the policy-level one", () => {
    const policy: OdrlPolicy = {
      id: "p",
      assignee: BOB,
      permissions: [{ type: "permission", action: "read", target: RES, assignee: CAROL }],
    };
    expect(
      evaluate(policy, { agent: CAROL, action: "read", target: RES }, { now: NOW }).decision,
    ).toBe("permit");
    expect(
      evaluate(policy, { agent: BOB, action: "read", target: RES }, { now: NOW }).decision,
    ).toBe("notApplicable");
  });

  it("in-memory and serialise→parse evaluation agree on inherited assignee", async () => {
    const { policyToTurtle, parsePolicy } = await import("../src/policy.js");
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/inh",
      assignee: BOB,
      permissions: [{ type: "permission", action: "read", target: RES }],
    };
    const roundTripped = await parsePolicy(await policyToTurtle(policy));
    expect(roundTripped).toBeDefined();
    const direct = evaluate(policy, { agent: CAROL, action: "read", target: RES }, { now: NOW });
    const viaRdf = evaluate(
      roundTripped as OdrlPolicy,
      { agent: CAROL, action: "read", target: RES },
      { now: NOW },
    );
    expect(direct.decision).toBe(viaRdf.decision);
    expect(direct.decision).toBe("notApplicable");
  });
});

describe("action implication (odrl:use umbrella)", () => {
  it("a use permission covers a concrete read request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "use", target: RES }],
    };
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("permit");
  });

  it("a use prohibition covers a concrete write request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      prohibitions: [{ type: "prohibition", action: "use", target: RES }],
    };
    const r = evaluate(policy, { action: "write", target: RES }, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("a read permission does NOT cover a write request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES }],
    };
    const r = evaluate(policy, { action: "write", target: RES }, { now: NOW });
    expect(r.decision).toBe("notApplicable");
  });
});

describe("conflict resolution", () => {
  const conflicting = (conflict?: OdrlPolicy["conflict"]): OdrlPolicy => ({
    id: "p",
    ...(conflict !== undefined && { conflict }),
    permissions: [{ type: "permission", action: "read", target: RES }],
    prohibitions: [{ type: "prohibition", action: "read", target: RES }],
  });

  it("defaults to prohibit (deny wins) when no strategy is set", () => {
    const r = evaluate(conflicting(), { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.conflict).toBe(true);
  });

  it("odrl:perm → permit (permission overrides)", () => {
    const r = evaluate(conflicting("perm"), { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.conflict).toBe(true);
  });

  it("odrl:prohibit → deny (prohibition overrides)", () => {
    const r = evaluate(conflicting("prohibit"), { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.conflict).toBe(true);
  });

  it("odrl:invalid → deny (policy void, fail-closed)", () => {
    const r = evaluate(conflicting("invalid"), { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.conflict).toBe(true);
    expect(r.reason).toContain("invalid");
  });

  it("no conflict when the permission and prohibition target different resources", () => {
    const policy: OdrlPolicy = {
      id: "p",
      conflict: "perm",
      permissions: [{ type: "permission", action: "read", target: RES }],
      prohibitions: [{ type: "prohibition", action: "read", target: OTHER }],
    };
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.conflict).toBe(false);
    expect(r.decision).toBe("permit");
  });
});

describe("constraint satisfaction (in evaluate)", () => {
  it("permits only when a purpose constraint is satisfied", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: "https://w3id.org/dpv#Research",
            },
          ],
        },
      ],
    };
    const ok = evaluate(
      policy,
      { action: "read", target: RES, attributes: { purpose: "https://w3id.org/dpv#Research" } },
      { now: NOW },
    );
    expect(ok.decision).toBe("permit");
    const wrong = evaluate(
      policy,
      { action: "read", target: RES, attributes: { purpose: "https://w3id.org/dpv#Marketing" } },
      { now: NOW },
    );
    expect(wrong.decision).toBe("notApplicable");
  });

  it("fails closed: a constrained permission does not match when the context omits the value", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: "https://w3id.org/dpv#Research",
            },
          ],
        },
      ],
    };
    // No `purpose` asserted → constraint unsatisfied → no match.
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("notApplicable");
  });

  it("requires ALL constraints on a rule (AND semantics)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: "https://w3id.org/dpv#Research",
            },
            { leftOperand: "count", operator: "lteq", rightOperand: 3 },
          ],
        },
      ],
    };
    const both = evaluate(
      policy,
      {
        action: "read",
        target: RES,
        attributes: { purpose: "https://w3id.org/dpv#Research", count: 2 },
      },
      { now: NOW },
    );
    expect(both.decision).toBe("permit");
    const onlyOne = evaluate(
      policy,
      {
        action: "read",
        target: RES,
        attributes: { purpose: "https://w3id.org/dpv#Research", count: 9 },
      },
      { now: NOW },
    );
    expect(onlyOne.decision).toBe("notApplicable");
  });

  it("evaluates a dateTime window against the injected now", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          constraints: [
            { leftOperand: "dateTime", operator: "lteq", rightOperand: "2026-12-31T23:59:59Z" },
          ],
        },
      ],
    };
    // now (2026-06-16) is before the deadline → permit.
    expect(evaluate(policy, { action: "read", target: RES }, { now: NOW }).decision).toBe("permit");
    // A now after the deadline → no match.
    const late = evaluate(
      policy,
      { action: "read", target: RES },
      {
        now: new Date("2027-02-01T00:00:00Z"),
      },
    );
    expect(late.decision).toBe("notApplicable");
  });
});

describe("duties", () => {
  const policyWithDuty: OdrlPolicy = {
    id: "p",
    permissions: [
      {
        type: "permission",
        action: "read",
        target: RES,
        assignee: BOB,
        duties: [{ action: "attribute" }],
      },
    ],
  };

  it("advisory by default: permits with the duty reported unfulfilled", () => {
    const r = evaluate(policyWithDuty, { agent: BOB, action: "read", target: RES }, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.duties.length).toBe(1);
    expect(r.duties[0]?.action).toBe("attribute");
    expect(r.duties[0]?.fulfilled).toBe(false);
  });

  it("requireDuties: denies when a duty is unfulfilled", () => {
    const r = evaluate(
      policyWithDuty,
      { agent: BOB, action: "read", target: RES },
      { now: NOW, requireDuties: true },
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("unfulfilled");
  });

  it("requireDuties: permits when the duty is asserted discharged", () => {
    const r = evaluate(
      policyWithDuty,
      { agent: BOB, action: "read", target: RES, attributes: { "fulfilled:attribute": true } },
      { now: NOW, requireDuties: true },
    );
    expect(r.decision).toBe("permit");
    expect(r.duties[0]?.fulfilled).toBe(true);
  });

  it("only the matched permission's duties are active", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        { type: "permission", action: "write", target: RES, duties: [{ action: "compensate" }] },
      ],
    };
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.duties.map((d) => d.action)).toEqual(["attribute"]);
  });

  it("does NOT leak a same-action non-matching rule's duties (roborev Medium fix)", () => {
    // Two SAME-action (read) permissions, differing only by target. The request
    // targets RES → only the first rule matches → only its duty is active. The
    // earlier action-only fallback would have leaked the OTHER's duty.
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        { type: "permission", action: "read", target: OTHER, duties: [{ action: "compensate" }] },
      ],
    };
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.duties.map((d) => d.action)).toEqual(["attribute"]);
  });

  it("does NOT wrongly deny under requireDuties due to a leaked duty (roborev Medium fix)", () => {
    // The matching rule (target RES) has its duty discharged; the non-matching
    // same-action rule (target OTHER) has an undischarged duty. requireDuties must
    // NOT deny on the non-matching rule's duty.
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        { type: "permission", action: "read", target: OTHER, duties: [{ action: "compensate" }] },
      ],
    };
    const r = evaluate(
      policy,
      { action: "read", target: RES, attributes: { "fulfilled:attribute": true } },
      { now: NOW, requireDuties: true },
    );
    expect(r.decision).toBe("permit");
    expect(r.duties.map((d) => d.action)).toEqual(["attribute"]);
  });

  it("policy-level obligations are always active on a permit", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES }],
      obligations: [{ action: "inform", target: OWNER }],
    };
    const r = evaluate(policy, { action: "read", target: RES }, { now: NOW });
    expect(r.duties.some((d) => d.action === "inform")).toBe(true);
  });

  it("a duty constraint must hold for the duty to count as fulfilled", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          duties: [
            {
              action: "compensate",
              constraints: [{ leftOperand: "count", operator: "gteq", rightOperand: 1 }],
            },
          ],
        },
      ],
    };
    // Discharge asserted but the duty's own constraint (count>=1) unmet → not fulfilled.
    const r = evaluate(
      policy,
      { action: "read", target: RES, attributes: { "fulfilled:compensate": true, count: 0 } },
      { now: NOW },
    );
    expect(r.duties[0]?.fulfilled).toBe(false);
  });
});

describe("constraintSatisfied (operator matrix)", () => {
  const req = (attrs: RequestContext["attributes"]): RequestContext => ({
    action: "read",
    ...(attrs !== undefined && { attributes: attrs }),
  });
  const sat = (c: OdrlConstraint, attrs: RequestContext["attributes"]): boolean =>
    constraintSatisfied(c, req(attrs), NOW);

  it("eq / neq (lexical + numeric)", () => {
    expect(
      sat({ leftOperand: "purpose", operator: "eq", rightOperand: "x" }, { purpose: "x" }),
    ).toBe(true);
    expect(
      sat({ leftOperand: "purpose", operator: "eq", rightOperand: "x" }, { purpose: "y" }),
    ).toBe(false);
    expect(sat({ leftOperand: "count", operator: "neq", rightOperand: 5 }, { count: 4 })).toBe(
      true,
    );
    expect(sat({ leftOperand: "count", operator: "eq", rightOperand: 5 }, { count: 5 })).toBe(true);
  });

  it("gt / gteq / lt / lteq (numeric)", () => {
    expect(sat({ leftOperand: "count", operator: "gt", rightOperand: 3 }, { count: 4 })).toBe(true);
    expect(sat({ leftOperand: "count", operator: "gt", rightOperand: 3 }, { count: 3 })).toBe(
      false,
    );
    expect(sat({ leftOperand: "count", operator: "gteq", rightOperand: 3 }, { count: 3 })).toBe(
      true,
    );
    expect(sat({ leftOperand: "count", operator: "lt", rightOperand: 3 }, { count: 2 })).toBe(true);
    expect(sat({ leftOperand: "count", operator: "lteq", rightOperand: 3 }, { count: 3 })).toBe(
      true,
    );
    expect(sat({ leftOperand: "count", operator: "lteq", rightOperand: 3 }, { count: 4 })).toBe(
      false,
    );
  });

  it("temporal compare on dateTime", () => {
    expect(
      sat(
        { leftOperand: "dateTime", operator: "lt", rightOperand: "2026-07-01T00:00:00Z" },
        { dateTime: "2026-06-16T00:00:00Z" },
      ),
    ).toBe(true);
    expect(
      sat(
        { leftOperand: "dateTime", operator: "gt", rightOperand: "2026-07-01T00:00:00Z" },
        { dateTime: "2026-06-16T00:00:00Z" },
      ),
    ).toBe(false);
  });

  it("isAnyOf / isNoneOf / isAllOf", () => {
    expect(
      sat(
        { leftOperand: "purpose", operator: "isAnyOf", rightOperand: ["a", "b"] },
        { purpose: "b" },
      ),
    ).toBe(true);
    expect(
      sat(
        { leftOperand: "purpose", operator: "isAnyOf", rightOperand: ["a", "b"] },
        { purpose: "c" },
      ),
    ).toBe(false);
    expect(
      sat(
        { leftOperand: "purpose", operator: "isNoneOf", rightOperand: ["a", "b"] },
        { purpose: "c" },
      ),
    ).toBe(true);
    expect(
      sat(
        { leftOperand: "purpose", operator: "isAllOf", rightOperand: ["a", "b"] },
        { purpose: ["a", "b", "c"] },
      ),
    ).toBe(true);
    expect(
      sat(
        { leftOperand: "purpose", operator: "isAllOf", rightOperand: ["a", "b"] },
        { purpose: ["a"] },
      ),
    ).toBe(false);
  });

  it("fails closed when the constrained value is absent", () => {
    expect(sat({ leftOperand: "purpose", operator: "eq", rightOperand: "x" }, {})).toBe(false);
    expect(sat({ leftOperand: "count", operator: "lteq", rightOperand: 5 }, undefined)).toBe(false);
  });

  it("a boolean attribute is not treated as a constraint operand (fail-closed)", () => {
    // recipient asserted as a boolean is meaningless for a constraint → unsatisfied.
    expect(
      sat({ leftOperand: "recipient", operator: "eq", rightOperand: BOB }, { recipient: true }),
    ).toBe(false);
  });
});
