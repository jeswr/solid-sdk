// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { evaluateIntent, solidOdrlEngine } from "../src/policy.js";
import { memoryMandateVerifier, scriptedPolicyEngine } from "../src/testing.js";
import {
  AGENT,
  type Decision,
  type Effect,
  type Intent,
  type Policy,
  type Rule,
} from "../src/types.js";
import { ACTOR, clock, intent, mandate } from "./helpers.js";

const effects: Effect[] = ["permit", "prohibited", "not-applicable", "indeterminate"];
const matrix = effects.flatMap((auto) =>
  effects.flatMap((approval) =>
    effects.map((root) => {
      const expected: Decision = [auto, approval, root].includes("prohibited")
        ? { decision: "prohibited", reason: "prohibition" }
        : [auto, approval, root].includes("indeterminate")
          ? { decision: "confirm-required", reason: "indeterminate" }
          : auto === "permit"
            ? { decision: "permit", reason: "autonomous" }
            : {
                decision: "confirm-required",
                reason: approval === "permit" ? "owner-approval" : "no-matching-rule",
              };
      return { auto, approval, root, ...expected };
    }),
  ),
);
describe("decision matrix: each row declares decision and reason", () => {
  it.each(matrix)("$auto / $approval / $root → $decision ($reason)", async ({
    auto,
    approval,
    root,
    decision,
    reason,
  }) => {
    const m = mandate();
    expect(
      await evaluateIntent(
        m,
        intent(),
        scriptedPolicyEngine({
          [m.autonomous.id]: auto,
          [m.withApproval.id]: approval,
          [m.id]: root,
        }),
      ),
    ).toEqual({ decision, reason });
  });
});
it("fails closed before asking any engine", async () => {
  expect(await evaluateIntent(undefined, intent())).toEqual({
    decision: "refuse-all",
    reason: "mandate-invalid",
  });
  for (const [field, value, reason] of [
    ["validUntil", clock().toISOString(), "mandate-expired"],
    ["validFrom", "2099-01-01", "mandate-not-yet-valid"],
    ["validUntil", "invalid", "mandate-invalid"],
    ["validFrom", "invalid", "mandate-invalid"],
    ["subject", "https://other.example/#me", "wrong-agent"],
  ] as const) {
    expect(await evaluateIntent({ ...mandate(), [field]: value }, intent())).toEqual({
      decision: "refuse-all",
      reason,
    });
  }
  expect((await evaluateIntent(mandate(), intent({ at: "invalid" }))).reason).toBe(
    "mandate-invalid",
  );
});
it("defaults to approval, respects root prohibitions, and survives engine failure", async () => {
  const m = mandate();
  expect(await evaluateIntent(m, intent())).toEqual({
    decision: "confirm-required",
    reason: "owner-approval",
  });
  expect((await evaluateIntent(m, intent({ action: `${AGENT}Transfer` }))).decision).toBe(
    "prohibited",
  );
  expect(
    (
      await evaluateIntent(
        m,
        intent({ action: `${AGENT}BookAppointment`, attributes: { [`${AGENT}costExceeds`]: 10 } }),
      )
    ).decision,
  ).toBe("prohibited");
  expect(
    (
      await evaluateIntent(m, intent(), {
        id: "throw",
        evaluate() {
          throw new Error("offline");
        },
      })
    ).reason,
  ).toBe("indeterminate");
  expect((await evaluateIntent(m, intent({ action: "read" }))).reason).toBe("no-matching-rule");
});
it("provides explicit test seams", async () => {
  const m = mandate();
  expect(await memoryMandateVerifier(m).load()).toBe(m);
  expect(await memoryMandateVerifier(undefined).load()).toBeUndefined();
  expect(await scriptedPolicyEngine({}).evaluate(m.autonomous, intent())).toEqual({
    effect: "indeterminate",
  });
});
const permit: Rule = { type: "permission", action: "read" };
const policy = (extra: Partial<Policy> = {}): Policy => ({
  id: "urn:example:policy",
  permissions: [permit],
  ...extra,
});
it("matches action, target, inherited and rule parties without broadening", async () => {
  const query = intent({ action: "read" });
  const run = (p: Policy) => solidOdrlEngine.evaluate(p, query);
  expect(await run(policy())).toEqual({ effect: "permit" });
  expect(
    await run(policy({ permissions: [{ ...permit, target: query.target, assignee: ACTOR }] })),
  ).toEqual({ effect: "permit" });
  for (const p of [
    policy({ permissions: [{ ...permit, target: "urn:other" }] }),
    policy({ assignee: "urn:other" }),
    policy({ permissions: [{ ...permit, action: "write" }] }),
  ])
    expect(await run(p)).toEqual({ effect: "not-applicable" });
  expect(await run(policy({ assignee: ACTOR }))).toEqual({ effect: "permit" });
  expect(await run(policy({ permissions: [{ ...permit, action: "use" }] }))).toEqual({
    effect: "permit",
  });
  expect(await run({ id: "urn:empty" })).toEqual({ effect: "not-applicable" });
});
it("requires missing context and outstanding duties to be confirmed", async () => {
  const q = intent({ action: "read" });
  expect(
    await solidOdrlEngine.evaluate(
      policy({
        permissions: [
          {
            ...permit,
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: "purpose" }],
          },
        ],
      }),
      q,
    ),
  ).toEqual({ effect: "indeterminate" });
  expect(
    await solidOdrlEngine.evaluate(
      policy({ permissions: [{ ...permit, duties: [{ action: "inform" }] }] }),
      q,
    ),
  ).toEqual({ effect: "indeterminate" });
  expect(
    await solidOdrlEngine.evaluate(
      policy({ permissions: [{ ...permit, duties: [{ action: "inform" }] }] }),
      { ...q, attributes: { "fulfilled:inform": true } },
    ),
  ).toEqual({ effect: "permit" });
});
it.each([
  { name: "empty rules", permissions: [] },
  { name: "different action", permissions: [{ ...permit, action: "write" }] },
  { name: "different target", permissions: [{ ...permit, target: "urn:other" }] },
  { name: "different assignee", permissions: [{ ...permit, assignee: "urn:other" }] },
  {
    name: "unsatisfied constraint",
    permissions: [
      {
        ...permit,
        constraints: [{ leftOperand: "count", operator: "eq" as const, rightOperand: 2 }],
      },
    ],
  },
])("retains policy obligations with $name until discharged", async ({ permissions }) => {
  const m = {
    ...mandate(),
    autonomous: policy(),
    withApproval: policy({ permissions, obligations: [{ action: "inform" }] }),
  };
  const q = intent({ action: "read", attributes: { count: 1 } });
  expect(await solidOdrlEngine.evaluate(m.withApproval, q)).toEqual({ effect: "indeterminate" });
  expect(await evaluateIntent(m, q)).toEqual({
    decision: "confirm-required",
    reason: "indeterminate",
  });
  for (const discharged of [true, "true", 1]) {
    const fulfilled = { ...q, attributes: { ...q.attributes, "fulfilled:inform": discharged } };
    expect(await solidOdrlEngine.evaluate(m.withApproval, fulfilled)).toEqual({
      effect: "not-applicable",
    });
    expect(await evaluateIntent(m, fulfilled)).toEqual({
      decision: "permit",
      reason: "autonomous",
    });
  }
});
it("requires obligation constraints as well as discharge evidence even without a matching rule", async () => {
  const p = policy({
    permissions: [],
    obligations: [
      {
        action: "inform",
        constraints: [{ leftOperand: "count", operator: "gteq", rightOperand: 1 }],
      },
    ],
  });
  const contexts: NonNullable<Intent["attributes"]>[] = [
    { "fulfilled:inform": false, count: 1 },
    { "fulfilled:inform": "false", count: 1 },
    { "fulfilled:inform": 0, count: 1 },
    { "fulfilled:inform": true },
    ...[true, [], Number.NaN, "invalid-number", 0].map((count) => ({
      "fulfilled:inform": true,
      count,
    })),
  ];
  for (const attributes of contexts) {
    const q = intent({ action: "read", attributes });
    expect(await solidOdrlEngine.evaluate(p, q)).toEqual({ effect: "indeterminate" });
    expect(
      await evaluateIntent({ ...mandate(), autonomous: policy(), withApproval: p }, q),
    ).toEqual({
      decision: "confirm-required",
      reason: "indeterminate",
    });
  }
  const fulfilled = intent({ action: "read", attributes: { "fulfilled:inform": true, count: 1 } });
  expect(await solidOdrlEngine.evaluate(p, fulfilled)).toEqual({ effect: "not-applicable" });
  expect(await solidOdrlEngine.evaluate(policy({ obligations: p.obligations }), fulfilled)).toEqual(
    { effect: "permit" },
  );
  const m = {
    ...mandate(),
    autonomous: policy(),
    withApproval: p,
    prohibitions: [{ type: "prohibition" as const, action: "read" }],
  };
  expect(await evaluateIntent(m, intent({ action: "read" }))).toEqual({
    decision: "prohibited",
    reason: "prohibition",
  });
  expect(
    await solidOdrlEngine.evaluate(
      { ...p, prohibitions: m.prohibitions },
      intent({ action: "read" }),
    ),
  ).toEqual({ effect: "prohibited" });
});
it("turns unsupported vocabulary into confirmation and preserves prohibition precedence", async () => {
  for (const p of [
    policy({ conflict: "perm" }),
    policy({ profile: "urn:unknown" }),
    policy({ permissions: [{ ...permit, action: "unknown" }] }),
    policy({
      permissions: [
        { ...permit, constraints: [{ leftOperand: "unknown", operator: "eq", rightOperand: 1 }] },
      ],
    }),
    policy({
      permissions: [
        {
          ...permit,
          constraints: [{ leftOperand: "count", operator: "unknown" as "eq", rightOperand: 1 }],
        },
      ],
    }),
  ]) {
    expect(await solidOdrlEngine.evaluate(p, intent({ action: "read" }))).toEqual({
      effect: "indeterminate",
    });
    expect(
      (
        await evaluateIntent(
          { ...mandate(), autonomous: p },
          intent({ action: "read" }),
          scriptedPolicyEngine({
            [p.id]: "permit",
            [mandate().withApproval.id]: "not-applicable",
            [mandate().id]: "not-applicable",
          }),
        )
      ).reason,
    ).toBe("indeterminate");
  }
  const p = policy({
    prohibitions: [{ type: "prohibition", action: "read" }],
    permissions: [
      {
        ...permit,
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: "missing" }],
      },
    ],
  });
  expect(await solidOdrlEngine.evaluate(p, intent({ action: "read" }))).toEqual({
    effect: "prohibited",
  });
});
it("requires confirmation for unsupported duties even if context claims fulfillment", async () => {
  for (const p of [
    policy({ obligations: [{ action: "unknown" as "inform" }] }),
    policy({ permissions: [{ ...permit, duties: [{ action: "unknown" as "inform" }] }] }),
    policy({
      obligations: [
        {
          action: "inform",
          constraints: [{ leftOperand: "unknown" as "purpose", operator: "eq", rightOperand: "x" }],
        },
      ],
    }),
    policy({
      obligations: [
        {
          action: "inform",
          constraints: [{ leftOperand: "purpose", operator: "unknown" as "eq", rightOperand: "x" }],
        },
      ],
    }),
    policy({
      obligations: [
        {
          action: "inform",
          constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: "x" }],
        },
      ],
    }),
  ]) {
    expect(
      await solidOdrlEngine.evaluate(
        p,
        intent({ action: "read", attributes: { "fulfilled:unknown": true, purpose: "y" } }),
      ),
    ).toEqual({ effect: "indeterminate" });
  }
  expect(
    await solidOdrlEngine.evaluate(
      policy({ conflict: "perm", prohibitions: [{ type: "prohibition", action: "read" }] }),
      intent({ action: "read" }),
    ),
  ).toEqual({ effect: "prohibited" });
});
it("never treats malformed constraint context as a disproved prohibition", async () => {
  const prohibit = (leftOperand: string, rightOperand: string | number): Policy =>
    policy({
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          constraints: [{ leftOperand, operator: "eq", rightOperand }],
        },
      ],
    });
  for (const value of [true, [], Number.NaN, Number.POSITIVE_INFINITY])
    expect(
      await solidOdrlEngine.evaluate(
        prohibit("purpose", "urn:prohibited"),
        intent({ action: "read", attributes: { purpose: value } }),
      ),
    ).toEqual({ effect: "indeterminate" });
  expect(
    await solidOdrlEngine.evaluate(
      prohibit("count", 10),
      intent({ action: "read", attributes: { count: "invalid-number" } }),
    ),
  ).toEqual({ effect: "indeterminate" });
  expect(
    await solidOdrlEngine.evaluate(
      prohibit("count", 10),
      intent({ action: "read", attributes: { count: 1 } }),
    ),
  ).toEqual({ effect: "permit" });
  expect(
    await solidOdrlEngine.evaluate(
      prohibit("dateTime", "2026-10-26T12:00:00Z"),
      intent({ action: "read", at: "invalid" }),
    ),
  ).toEqual({ effect: "indeterminate" });
  expect(
    await solidOdrlEngine.evaluate(
      prohibit("dateTime", "2026-10-27T12:00:00Z"),
      intent({ action: "read" }),
    ),
  ).toEqual({ effect: "permit" });
});

it("requires confirmation for an empty constraint right operand", async () => {
  expect(
    await solidOdrlEngine.evaluate(
      policy({
        permissions: [
          {
            ...permit,
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: [] }],
          },
        ],
      }),
      intent({ action: "read", attributes: { purpose: "x" } }),
    ),
  ).toEqual({ effect: "indeterminate" });
});
