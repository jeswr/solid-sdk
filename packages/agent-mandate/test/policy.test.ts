// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { evaluateIntent, solidOdrlEngine } from "../src/policy.js";
import { memoryMandateVerifier, scriptedPolicyEngine } from "../src/testing.js";
import { AGENT, type Decision, type Effect, type Policy, type Rule } from "../src/types.js";
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
