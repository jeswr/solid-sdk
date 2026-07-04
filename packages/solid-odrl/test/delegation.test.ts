// AUTHORED-BY Claude Fable 5
//
// Unit tests for the agent-delegation profile chain evaluator
// (src/delegation.ts) + the PROV-O provenance overlay + the delegation-term
// round-trip. Adversarial by design: every fail-closed branch (malformed, cyclic,
// over-broad, expired, revoked, depth-exceeded, assignee-free, umbrella-escalation,
// injected-attribute) is exercised as a DENY, and the valid 1-/2-/3-hop chains as
// the only PERMITs.

import { describe, expect, it } from "vitest";
import { delegationProvenance, evaluateDelegated } from "../src/delegation.js";
import { evaluate } from "../src/evaluate.js";
import { parsePolicy, policyFromRdf, policyToJsonLd, policyToTurtle } from "../src/policy.js";
import { serialize } from "../src/serialize.js";
import type { OdrlPolicy, RequestContext } from "../src/types.js";
import {
  ODRLD_DELEGATED_UNDER,
  PROV_ACTED_ON_BEHALF_OF,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
} from "../src/vocab.js";

const OWNER = "https://alice.example/profile/card#me";
const AGENT_A = "https://agent-a.example/id#it";
const AGENT_B = "https://agent-b.example/id#it";
const AGENT_C = "https://agent-c.example/id#it";
const RES = "https://alice.example/data/records.ttl";
const NOW = new Date("2026-07-01T12:00:00Z");
const PAST = "2026-01-01T00:00:00Z";
const FUTURE = "2027-01-01T00:00:00Z";

const ROOT_ID = "https://alice.example/policies/root";
const HOP1_ID = "https://agent-a.example/policies/to-b";
const HOP2_ID = "https://agent-b.example/policies/to-c";

/** Root grant O→A: read on RES + explicit grantUse (depth budget as given). */
function root(opts: { depth?: number; grantUse?: boolean; nextPolicy?: string } = {}): OdrlPolicy {
  const { depth, grantUse = true, nextPolicy } = opts;
  return {
    id: ROOT_ID,
    type: "Agreement",
    assigner: OWNER,
    permissions: [
      { type: "permission", action: "read", target: RES, assignee: AGENT_A },
      ...(grantUse
        ? [
            {
              type: "permission" as const,
              action: "grantUse" as const,
              target: RES,
              assignee: AGENT_A,
              ...(depth !== undefined && {
                constraints: [
                  {
                    leftOperand: "delegationDepth" as const,
                    operator: "lteq" as const,
                    rightOperand: depth,
                  },
                ],
              }),
              ...(nextPolicy !== undefined && {
                duties: [{ action: "nextPolicy" as const, target: nextPolicy }],
              }),
            },
          ]
        : []),
    ],
  };
}

/** Delegated hop A→B: read on RES, declared under the root. */
function hop1(overrides: Partial<OdrlPolicy> = {}): OdrlPolicy {
  return {
    id: HOP1_ID,
    type: "Agreement",
    assigner: AGENT_A,
    assignee: AGENT_B,
    delegatedUnder: ROOT_ID,
    permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_B }],
    ...overrides,
  };
}

/** Second delegated hop B→C: read on RES, declared under hop 1. */
function hop2(overrides: Partial<OdrlPolicy> = {}): OdrlPolicy {
  return {
    id: HOP2_ID,
    type: "Agreement",
    assigner: AGENT_B,
    assignee: AGENT_C,
    delegatedUnder: HOP1_ID,
    permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_C }],
    ...overrides,
  };
}

const READ_B: RequestContext = { agent: AGENT_B, action: "read", target: RES };
const READ_C: RequestContext = { agent: AGENT_C, action: "read", target: RES };

describe("evaluateDelegated: chain shape (fail-closed)", () => {
  it("denies an empty chain", () => {
    const r = evaluateDelegated([], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/empty/i);
  });

  it("denies a chain exceeding maxChainLength", () => {
    const r = evaluateDelegated([root({ depth: 5 }), hop1(), hop2()], READ_C, {
      now: NOW,
      maxChainLength: 2,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/exceeds the maximum/);
  });

  it("denies an invalid maxChainLength (0, negative, non-integer)", () => {
    for (const maxChainLength of [0, -1, 1.5]) {
      const r = evaluateDelegated(
        [root()],
        { agent: AGENT_A, action: "read", target: RES },
        {
          now: NOW,
          maxChainLength,
        },
      );
      expect(r.decision).toBe("deny");
    }
  });

  it("denies a hop with no id", () => {
    const bad = { ...hop1(), id: "" };
    const r = evaluateDelegated([root(), bad], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no policy id/);
  });

  it("denies a cyclic chain (a policy repeated)", () => {
    const r = evaluateDelegated([root({ depth: 5 }), hop1(), root({ depth: 5 })], READ_B, {
      now: NOW,
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/[Cc]ycl/);
  });

  it("denies a delegated hop that is not an Agreement", () => {
    for (const type of ["Offer", "Set", undefined] as const) {
      const r = evaluateDelegated([root(), hop1({ type })], READ_B, { now: NOW });
      expect(r.decision).toBe("deny");
      expect(r.reason).toMatch(/must be an odrl:Agreement/);
    }
  });

  it("denies a delegated hop missing assigner or assignee", () => {
    const noAssigner = evaluateDelegated([root(), hop1({ assigner: undefined })], READ_B, {
      now: NOW,
    });
    expect(noAssigner.decision).toBe("deny");
    const noAssignee = evaluateDelegated([root(), hop1({ assignee: undefined })], READ_B, {
      now: NOW,
    });
    expect(noAssignee.decision).toBe("deny");
  });

  it("denies a hop missing (or mis-stating) delegatedUnder", () => {
    const missing = evaluateDelegated([root(), hop1({ delegatedUnder: undefined })], READ_B, {
      now: NOW,
    });
    expect(missing.decision).toBe("deny");
    expect(missing.reason).toMatch(/delegatedUnder/);
    const wrong = evaluateDelegated(
      [root(), hop1({ delegatedUnder: "https://evil.example/policies/other" })],
      READ_B,
      { now: NOW },
    );
    expect(wrong.decision).toBe("deny");
  });
});

describe("evaluateDelegated: authorization (grantUse)", () => {
  it("permits a valid single-hop delegation", () => {
    const r = evaluateDelegated([root(), hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.hops).toEqual([{ index: 1, policyId: HOP1_ID, ok: true, reason: "ok" }]);
    expect(r.leaf?.decision).toBe("permit");
  });

  it("a single-policy chain degenerates to evaluate()", () => {
    const direct: RequestContext = { agent: AGENT_A, action: "read", target: RES };
    expect(evaluateDelegated([root()], direct, { now: NOW }).decision).toBe("permit");
    // …but never yields notApplicable: an unmatched request is a deny.
    const r = evaluateDelegated(
      [root()],
      { agent: AGENT_B, action: "read", target: RES },
      {
        now: NOW,
      },
    );
    expect(r.decision).toBe("deny");
  });

  it("denies when the parent has NO grantUse permission at all", () => {
    const r = evaluateDelegated([root({ grantUse: false }), hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/does not cleanly authorise delegation/);
  });

  it("a broad `use` permission does NOT authorise delegation (profile restriction)", () => {
    const broadRoot: OdrlPolicy = {
      id: ROOT_ID,
      type: "Agreement",
      assigner: OWNER,
      permissions: [{ type: "permission", action: "use", target: RES, assignee: AGENT_A }],
    };
    const r = evaluateDelegated([broadRoot, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("an assignee-FREE grantUse does not authorise delegation (explicit-assignee rule)", () => {
    const anyoneMayDelegate: OdrlPolicy = {
      id: ROOT_ID,
      type: "Agreement",
      assigner: OWNER,
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        { type: "permission", action: "grantUse", target: RES }, // no assignee
      ],
    };
    const r = evaluateDelegated([anyoneMayDelegate, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/explicitly naming/);
  });

  it("a grantUse permission for a DIFFERENT agent does not authorise the edge", () => {
    const wrongDelegate: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_C },
      ],
    };
    const r = evaluateDelegated([wrongDelegate, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("a prohibition on grantUse defeats the grant (default prohibit conflict)", () => {
    const conflicted: OdrlPolicy = {
      ...root(),
      prohibitions: [{ type: "prohibition", action: "grantUse", target: RES, assignee: AGENT_A }],
    };
    const r = evaluateDelegated([conflicted, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("an EXPIRED grantUse (temporal constraint in the past) denies the edge", () => {
    const expiredGrant: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_A,
          constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: PAST }],
        },
      ],
    };
    const r = evaluateDelegated([expiredGrant, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
  });
});

describe("evaluateDelegated: depth bounding", () => {
  it("permits a 2-hop chain when the root grantUse budget covers it (lteq 2)", () => {
    const chain = [
      root({ depth: 2 }),
      hop1({
        permissions: [
          { type: "permission", action: "read", target: RES, assignee: AGENT_B },
          { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
        ],
      }),
      hop2(),
    ];
    const r = evaluateDelegated(chain, READ_C, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.hops.every((h) => h.ok)).toBe(true);
  });

  it("denies a 2-hop chain under the profile DEFAULT budget of 1 (no constraint)", () => {
    const chain = [
      root(), // grantUse without a delegationDepth constraint → budget 1
      hop1({
        permissions: [
          { type: "permission", action: "read", target: RES, assignee: AGENT_B },
          { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
        ],
      }),
      hop2(),
    ];
    const r = evaluateDelegated(chain, READ_C, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/default of 1 hop/);
  });

  it("denies a 2-hop chain when the explicit budget is lteq 1", () => {
    const chain = [
      root({ depth: 1 }),
      hop1({
        permissions: [
          { type: "permission", action: "read", target: RES, assignee: AGENT_B },
          { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
        ],
      }),
      hop2(),
    ];
    const r = evaluateDelegated(chain, READ_C, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("a caller-asserted delegationDepth attribute cannot bypass the budget", () => {
    const chain = [
      root(), // budget 1
      hop1({
        permissions: [
          { type: "permission", action: "read", target: RES, assignee: AGENT_B },
          { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
        ],
      }),
      hop2(),
    ];
    const r = evaluateDelegated(
      chain,
      { ...READ_C, attributes: { delegationDepth: 0 } },
      { now: NOW },
    );
    expect(r.decision).toBe("deny");
  });

  it("evaluate() alone never satisfies a delegationDepth constraint (reserved operand)", () => {
    // Outside the walker nothing supplies the operand — fail-closed.
    const r = evaluate(
      root({ depth: 3 }),
      { agent: AGENT_A, action: "grantUse", target: RES },
      { now: NOW },
    );
    expect(r.decision).toBe("notApplicable");
  });
});

describe("evaluateDelegated: scope intersection (conservative subset)", () => {
  it("denies an OVER-BROAD hop: the delegate cannot exceed the delegator's grant", () => {
    const overBroadLeaf = hop1({
      permissions: [{ type: "permission", action: "write", target: RES, assignee: AGENT_B }],
    });
    const r = evaluateDelegated(
      [root(), overBroadLeaf],
      { ...READ_B, action: "write" },
      {
        now: NOW,
      },
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/cannot receive more than the delegator holds/);
  });

  it("permits the in-scope part of a partially over-broad hop", () => {
    const mixedLeaf = hop1({
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_B },
        { type: "permission", action: "write", target: RES, assignee: AGENT_B },
      ],
    });
    // read is inside the root grant → permit; write is outside → deny.
    expect(evaluateDelegated([root(), mixedLeaf], READ_B, { now: NOW }).decision).toBe("permit");
    expect(
      evaluateDelegated([root(), mixedLeaf], { ...READ_B, action: "write" }, { now: NOW }).decision,
    ).toBe("deny");
  });

  it("action subsumption flows through the intersection (root write covers leaf append)", () => {
    const writeRoot: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "write", target: RES, assignee: AGENT_A },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
      ],
    };
    const appendLeaf = hop1({
      permissions: [{ type: "permission", action: "append", target: RES, assignee: AGENT_B }],
    });
    const r = evaluateDelegated(
      [writeRoot, appendLeaf],
      { ...READ_B, action: "append" },
      {
        now: NOW,
      },
    );
    expect(r.decision).toBe("permit");
  });

  it("denies when an EXPIRED mid-chain hop no longer grants the capability", () => {
    const expiredMid = hop1({
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          assignee: AGENT_B,
          constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: PAST }],
        },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
      ],
    });
    const chain = [root({ depth: 2 }), expiredMid, hop2()];
    const r = evaluateDelegated(chain, READ_C, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("permits while every hop is within its validity window", () => {
    const windowed = hop1({
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          assignee: AGENT_B,
          constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: FUTURE }],
        },
      ],
    });
    expect(evaluateDelegated([root(), windowed], READ_B, { now: NOW }).decision).toBe("permit");
  });

  it("an ancestor prohibition against the ACTUAL agent denies (no laundering)", () => {
    const prohibitingRoot: OdrlPolicy = {
      ...root(),
      prohibitions: [{ type: "prohibition", action: "read", target: RES, assignee: AGENT_B }],
    };
    const r = evaluateDelegated([prohibitingRoot, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/prohibits the request directly/);
  });

  it("prohibitions are STRICT in a chain: an ancestor's conflict:perm cannot override (roborev High)", () => {
    // The root PERMITS read to anyone AND prohibits read by B, with
    // conflict:"perm" — direct evaluation would permit B (perm overrides), but
    // a DELEGATED request must still deny: delegation never launders a request
    // around a matched prohibition.
    const permConflictRoot: OdrlPolicy = {
      ...root(),
      conflict: "perm",
      permissions: [
        { type: "permission", action: "read", target: RES },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
      ],
      prohibitions: [{ type: "prohibition", action: "read", target: RES, assignee: AGENT_B }],
    };
    // Sanity: DIRECT evaluation honours the policy's own conflict strategy.
    expect(evaluate(permConflictRoot, READ_B, { now: NOW }).decision).toBe("permit");
    // But the delegated chain is strict.
    const r = evaluateDelegated([permConflictRoot, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
  });

  it("prohibitions are STRICT on the grantUse edge under conflict:perm", () => {
    const permConflictGrant: OdrlPolicy = {
      ...root(),
      conflict: "perm",
      prohibitions: [{ type: "prohibition", action: "grantUse", target: RES, assignee: AGENT_A }],
    };
    const r = evaluateDelegated([permConflictGrant, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/does not cleanly authorise/);
  });

  it("prohibitions are STRICT in the leaf under conflict:perm (multi-policy chain only)", () => {
    const permConflictLeaf = hop1({
      conflict: "perm",
      permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_B }],
      prohibitions: [{ type: "prohibition", action: "read", target: RES, assignee: AGENT_B }],
    });
    const chained = evaluateDelegated([root(), permConflictLeaf], READ_B, { now: NOW });
    expect(chained.decision).toBe("deny");
    expect(chained.reason).toMatch(/prohibitions are strict/);
    // A SINGLE-policy chain keeps the policy's declared conflict semantics.
    const single = evaluateDelegated([{ ...permConflictLeaf, delegatedUnder: undefined }], READ_B, {
      now: NOW,
    });
    expect(single.decision).toBe("permit");
  });
});

describe("evaluateDelegated: nextPolicy (mandated downstream policy)", () => {
  it("permits when the delegated hop IS the mandated nextPolicy", () => {
    const r = evaluateDelegated([root({ nextPolicy: HOP1_ID }), hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("permit");
  });

  it("denies when the delegated hop is NOT the mandated nextPolicy", () => {
    const other = hop1({ id: "https://agent-a.example/policies/rogue", delegatedUnder: ROOT_ID });
    const r = evaluateDelegated([root({ nextPolicy: HOP1_ID }), other], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/mandates nextPolicy/);
  });

  it("denies a malformed nextPolicy duty (no target)", () => {
    const malformed: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_A,
          duties: [{ action: "nextPolicy" }],
        },
      ],
    };
    const r = evaluateDelegated([malformed, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no target policy/);
  });

  it("the mandated nextPolicy still narrows: out-of-scope requests deny", () => {
    // The mandated hop grants read only; a write request fails on the leaf even
    // though the chain shape is exactly as mandated.
    const r = evaluateDelegated(
      [root({ nextPolicy: HOP1_ID }), hop1()],
      { ...READ_B, action: "write" },
      { now: NOW },
    );
    expect(r.decision).toBe("deny");
  });
});

describe("evaluateDelegated: revocation + duties", () => {
  it("denies when any hop is revoked", () => {
    for (const revokedId of [ROOT_ID, HOP1_ID]) {
      const r = evaluateDelegated([root(), hop1()], READ_B, { now: NOW, revoked: [revokedId] });
      expect(r.decision).toBe("deny");
      expect(r.reason).toMatch(/revoked/);
    }
  });

  it("a bare-string revoked value still revokes (not a character set)", () => {
    // A plain-JS caller passing one IRI instead of an array must not silently
    // disable revocation (a string is an Iterable<string> of CHARACTERS).
    const r = evaluateDelegated([root(), hop1()], READ_B, {
      now: NOW,
      revoked: HOP1_ID as unknown as readonly string[],
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/revoked/);
  });

  it("a bare-string revoked value is a TYPE error (guards against re-widening to Iterable<string>)", () => {
    // Type-level regression, enforced by the typecheck gate (tsconfig.test.json):
    // if `revoked` were ever widened back to Iterable<string>, the bare string
    // below would start to typecheck and this @ts-expect-error would FAIL.
    const r = evaluateDelegated([root(), hop1()], READ_B, {
      now: NOW,
      // @ts-expect-error — a bare string must not satisfy the revoked type
      revoked: HOP1_ID,
    });
    expect(r.decision).toBe("deny");
  });

  it("revoked accepts a ReadonlySet", () => {
    const r = evaluateDelegated([root(), hop1()], READ_B, {
      now: NOW,
      revoked: new Set([HOP1_ID]),
    });
    expect(r.decision).toBe("deny");
  });

  it("aggregates duties down the chain (delegation never sheds a duty)", () => {
    const dutifulRoot: OdrlPolicy = {
      ...root(),
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          assignee: AGENT_A,
          duties: [{ action: "attribute", target: OWNER }],
        },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
      ],
    };
    const r = evaluateDelegated([dutifulRoot, hop1()], READ_B, { now: NOW });
    expect(r.decision).toBe("permit");
    expect(r.duties.map((d) => d.action)).toContain("attribute");
  });

  it("grantUse-edge duties join the aggregate and gate requireDuties (roborev Medium)", () => {
    // The delegation AUTHORITY itself is duty-conditioned: A must inform the
    // owner when delegating. The duty must surface in the chain result and
    // gate requireDuties — never be silently dropped.
    const dutyConditionedGrant: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_A,
          duties: [{ action: "inform", target: OWNER }],
        },
      ],
    };
    const advisory = evaluateDelegated([dutyConditionedGrant, hop1()], READ_B, { now: NOW });
    expect(advisory.decision).toBe("permit");
    expect(advisory.duties.map((d) => d.action)).toContain("inform");

    const gated = evaluateDelegated([dutyConditionedGrant, hop1()], READ_B, {
      now: NOW,
      requireDuties: true,
    });
    expect(gated.decision).toBe("deny");

    const discharged = evaluateDelegated(
      [dutyConditionedGrant, hop1()],
      { ...READ_B, attributes: { "fulfilled:inform": true } },
      { now: NOW, requireDuties: true },
    );
    expect(discharged.decision).toBe("permit");
  });

  it("duties of a NON-authorizing grantUse candidate never leak into the aggregate (roborev Medium)", () => {
    // Two grantUse rules for the same delegate: X mandates a nextPolicy that
    // was NOT delegated (fails) and carries an inform duty; Y is duty-free and
    // authorises. X's duty must not surface — under requireDuties it would
    // wrongly deny a chain whose actual authorizing rule is unconditioned.
    const twoCandidates: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_A,
          duties: [
            { action: "nextPolicy", target: "https://alice.example/policies/unused" },
            { action: "inform", target: OWNER },
          ],
        },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
      ],
    };
    const r = evaluateDelegated([twoCandidates, hop1()], READ_B, {
      now: NOW,
      requireDuties: true,
    });
    expect(r.decision).toBe("permit");
    expect(r.duties.map((d) => d.action)).not.toContain("inform");
  });

  it("duties of EVERY valid authorizing grantUse rule aggregate (roborev round-3 Medium)", () => {
    // Two grantUse rules BOTH authorise the edge; the second carries an inform
    // duty. The duty must still gate requireDuties — the profile matches the
    // core evaluator's conjunctive duty semantics over matched permissions
    // (deny-biased), so an authorizing rule's duty is never dropped just
    // because a duty-free sibling also authorises.
    const twoValid: OdrlPolicy = {
      ...root(),
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_A },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_A,
          duties: [{ action: "inform", target: OWNER }],
        },
      ],
    };
    const gated = evaluateDelegated([twoValid, hop1()], READ_B, {
      now: NOW,
      requireDuties: true,
    });
    expect(gated.decision).toBe("deny");
    expect(gated.duties.map((d) => d.action)).toContain("inform");

    const discharged = evaluateDelegated(
      [twoValid, hop1()],
      { ...READ_B, attributes: { "fulfilled:inform": true } },
      { now: NOW, requireDuties: true },
    );
    expect(discharged.decision).toBe("permit");
  });

  it("nextPolicy duties never enter the aggregate (structurally enforced, not dischargeable)", () => {
    const r = evaluateDelegated([root({ nextPolicy: HOP1_ID }), hop1()], READ_B, {
      now: NOW,
      requireDuties: true,
    });
    // The nextPolicy duty is satisfied structurally (the mandated hop WAS
    // delegated); it must not surface as an undischargeable required duty.
    expect(r.decision).toBe("permit");
    expect(r.duties.map((d) => d.action)).not.toContain("nextPolicy");
  });

  it("requireDuties gates on the AGGREGATE chain duties", () => {
    const dutifulRoot: OdrlPolicy = {
      ...root(),
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          assignee: AGENT_A,
          duties: [{ action: "attribute", target: OWNER }],
        },
        { type: "permission", action: "grantUse", target: RES, assignee: AGENT_A },
      ],
    };
    const undischarged = evaluateDelegated([dutifulRoot, hop1()], READ_B, {
      now: NOW,
      requireDuties: true,
    });
    expect(undischarged.decision).toBe("deny");
    expect(undischarged.duties.length).toBeGreaterThan(0);

    const discharged = evaluateDelegated(
      [dutifulRoot, hop1()],
      { ...READ_B, attributes: { "fulfilled:attribute": true } },
      { now: NOW, requireDuties: true },
    );
    expect(discharged.decision).toBe("permit");
  });
});

describe("evaluateDelegated: identity composition (actor must be the declared delegate)", () => {
  const mallory = "https://mallory.example/id#it";

  it("denies when a hop declaring A→B smuggles a permission granting a THIRD party (roborev/adversarial-verify High)", () => {
    // The hop declares itself A→B (odrl:assignee = B), but its permission grants
    // read to MALLORY. Before the identity-composition guard MALLORY was PERMITTED
    // (privilege bounded by A's grant) while the PROV overlay credited B — a
    // FORGED accountability attribution. It must now DENY.
    const sneakyHop = hop1({
      permissions: [{ type: "permission", action: "read", target: RES, assignee: mallory }],
    });
    const r = evaluateDelegated(
      [root(), sneakyHop],
      { agent: mallory, action: "read", target: RES },
      {
        now: NOW,
      },
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/identity-composition guard|declared delegate/);
  });

  it("still permits when the actor IS the declared delegate", () => {
    // Sanity: the guard does not deny the legitimate A→B delegation exercised by B.
    expect(evaluateDelegated([root(), hop1()], READ_B, { now: NOW }).decision).toBe("permit");
  });

  it("permits when the leaf permission omits its assignee and inherits the hop delegate", () => {
    // A permission with no explicit assignee inherits the hop's policy-level
    // assignee (B), so the actor B still matches the declared delegate.
    const inheritedHop = hop1({
      permissions: [{ type: "permission", action: "read", target: RES }],
    });
    expect(evaluateDelegated([root(), inheritedHop], READ_B, { now: NOW }).decision).toBe("permit");
  });

  it("does NOT apply the guard to a single-policy (direct, non-delegated) grant", () => {
    // A direct grant to a public policy has no declared delegate — the guard is
    // delegation-only and must not deny a legitimate direct request.
    const publicPolicy: OdrlPolicy = {
      id: ROOT_ID,
      type: "Agreement",
      assigner: OWNER,
      permissions: [{ type: "permission", action: "read", target: RES }], // no assignee
    };
    expect(
      evaluateDelegated(
        [publicPolicy],
        { agent: mallory, action: "read", target: RES },
        { now: NOW },
      ).decision,
    ).toBe("permit");
  });
});

describe("delegationProvenance", () => {
  it("emits the attribution + authority-edge + acted-on-behalf-of overlay", () => {
    const quads = delegationProvenance([root(), hop1()]);
    const triples = quads.map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`);
    expect(triples).toContain(`${ROOT_ID} ${PROV_WAS_ATTRIBUTED_TO} ${OWNER}`);
    expect(triples).toContain(`${HOP1_ID} ${PROV_WAS_ATTRIBUTED_TO} ${AGENT_A}`);
    expect(triples).toContain(`${HOP1_ID} ${ODRLD_DELEGATED_UNDER} ${ROOT_ID}`);
    expect(triples).toContain(`${HOP1_ID} ${PROV_WAS_DERIVED_FROM} ${ROOT_ID}`);
    expect(triples).toContain(`${AGENT_B} ${PROV_ACTED_ON_BEHALF_OF} ${AGENT_A}`);
  });

  it("neutralises a hostile IRI in a hop party — no triple injection into the audit trail (adversarial-verify High)", async () => {
    // n3.Writer emits an IRI verbatim inside <…>; an assigner value carrying a `>`
    // + spaces would otherwise break out and inject a FORGED prov:wasAttributedTo
    // triple, framing another principal in the accountability trail. The write
    // path must percent-escape it so the hostile value stays inside ONE object IRI
    // and no extra triples are minted.
    const hostile =
      "https://evil.example/x> <https://victim.example/policy> <http://www.w3.org/ns/prov#wasAttributedTo> <https://framed-victim.example/id#it> .\n<https://evil.example/x";
    const quads = delegationProvenance([
      {
        id: ROOT_ID,
        type: "Agreement",
        assigner: hostile,
        permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_A }],
      },
      hop1(),
    ]);
    const ttl = await serialize(quads);
    // The `>` breakout char survives only percent-escaped inside the object IRI.
    expect(ttl).toContain("%3E");
    // Re-parsing the serialised graph yields EXACTLY the triples we emitted — an
    // injection would add triples (a forged attribution to the framed victim).
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
    // No triple attributes anything to the framed victim as an OBJECT (it survives
    // only as inert text inside the one escaped assigner IRI), and no forged
    // subject is introduced.
    for (const q of reparsed) {
      expect(q.object.value).not.toBe("https://framed-victim.example/id#it");
      expect(q.subject.value).not.toBe("https://victim.example/policy");
    }
  });

  it("skips triples whose parties are absent and returns [] for an empty chain", () => {
    expect(delegationProvenance([])).toEqual([]);
    const quads = delegationProvenance([{ id: ROOT_ID }, hop1({ assigner: undefined })]);
    const preds = new Set(quads.map((q) => q.predicate.value));
    expect(preds.has(PROV_ACTED_ON_BEHALF_OF)).toBe(false);
  });
});

describe("delegation terms: RDF round-trip", () => {
  const delegated: OdrlPolicy = {
    id: HOP1_ID,
    type: "Agreement",
    assigner: AGENT_A,
    assignee: AGENT_B,
    delegatedUnder: ROOT_ID,
    permissions: [
      { type: "permission", action: "read", target: RES, assignee: AGENT_B },
      {
        type: "permission",
        action: "grantUse",
        target: RES,
        assignee: AGENT_B,
        constraints: [{ leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 }],
        duties: [{ action: "nextPolicy", target: HOP2_ID }],
      },
    ],
  };

  it("round-trips grantUse / nextPolicy / delegationDepth / delegatedUnder via Turtle", async () => {
    const turtle = await policyToTurtle(delegated);
    // The n3 writer prefixes odrl: terms; the odrld: terms appear as full IRIs.
    expect(turtle).toContain("odrl:grantUse");
    expect(turtle).toContain("odrl:nextPolicy");
    expect(turtle).toContain(ODRLD_DELEGATED_UNDER);
    const parsed = await parsePolicy(turtle);
    expect(parsed).toBeDefined();
    expect(parsed?.delegatedUnder).toBe(ROOT_ID);
    const grant = parsed?.permissions?.find((p) => p.action === "grantUse");
    expect(grant?.constraints?.[0]).toEqual({
      leftOperand: "delegationDepth",
      operator: "lteq",
      rightOperand: 1,
      // The parser preserves the typed-literal datatype on read (existing
      // behaviour for numeric operands — same as odrl:count).
      datatype: "http://www.w3.org/2001/XMLSchema#integer",
    });
    expect(grant?.duties?.[0]).toEqual({ action: "nextPolicy", target: HOP2_ID });
  });

  it("round-trips via JSON-LD, with the profile @context only when used", async () => {
    const doc = policyToJsonLd(delegated);
    const context = doc["@context"] as Record<string, unknown>;
    expect(context.delegatedUnder).toBeDefined();
    // A policy WITHOUT delegation fields keeps the unextended base context.
    const plainContext = policyToJsonLd({ id: ROOT_ID })["@context"] as Record<string, unknown>;
    expect(plainContext.delegatedUnder).toBeUndefined();

    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const parsed = policyFromRdf(dataset);
    expect(parsed?.delegatedUnder).toBe(ROOT_ID);
    expect(parsed?.permissions?.some((p) => p.action === "grantUse")).toBe(true);
  });
});
