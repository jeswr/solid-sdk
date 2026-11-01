// AUTHORED-BY Claude Opus 5.5
//
// Hardening regressions (sst-8xm.9.19):
//  - a request for a BROADER action than a prohibited one (write vs append,
//    use vs distribute) must not slip past "any prohibition wins";
//  - a multi-valued request operand must not satisfy an isAnyOf permission
//    allowlist because one element matches.

import { describe, expect, it } from "vitest";
import { candidate, evaluateIntent, solidOdrlEngine } from "../src/policy.js";
import type { Intent, Mandate, Rule } from "../src/types.js";
import { AGENT } from "../src/types.js";

const AG = "https://agent.example/#me";
const AT = "2026-06-01T00:00:00Z";
const TARGET = "https://pod.example/data/r";
const h = (c: string) => `sha256:${c.repeat(64)}`;

function mandateWith(permission: Rule, prohibitions: readonly Rule[] = []): Mandate {
  return {
    id: "urn:m",
    issuer: "https://owner.example/#me",
    subject: AG,
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    limits: [],
    autonomous: { id: "urn:a", type: "Set", permissions: [permission] },
    withApproval: { id: "urn:w", type: "Set", permissions: [] },
    prohibitions,
  };
}

const intent = (action: string, attributes?: Intent["attributes"]): Intent => ({
  agent: AG,
  action,
  target: TARGET,
  at: AT,
  ...(attributes !== undefined && { attributes }),
});

describe("a prohibition on a narrower action blocks a broader request", () => {
  for (const [permitted, prohibited, requested] of [
    ["write", "append", "write"],
    ["use", "distribute", "use"],
    ["use", "read", "use"],
  ] as const) {
    it(`permit ${permitted}, prohibit ${prohibited}, request ${requested} → prohibited`, async () => {
      const m = mandateWith({ type: "permission", action: permitted }, [
        { type: "prohibition", action: prohibited },
      ]);
      expect(await evaluateIntent(m, intent(requested))).toEqual({
        decision: "prohibited",
        reason: "prohibition",
      });
      // The narrow request itself was already prohibited.
      expect((await evaluateIntent(m, intent(prohibited))).decision).toBe("prohibited");
    });
  }

  it("an unrelated narrower prohibition does not block a request it does not cover", async () => {
    const m = mandateWith({ type: "permission", action: "use" }, [
      { type: "prohibition", action: "distribute" },
    ]);
    expect(await evaluateIntent(m, intent("read"))).toEqual({
      decision: "permit",
      reason: "autonomous",
    });
  });
});

describe("a multi-valued request operand cannot satisfy a permission allowlist", () => {
  const recipientSet = `${AGENT}recipientSet`;
  const send = `${AGENT}SendMessage`;
  const m = mandateWith({
    type: "permission",
    action: send,
    constraints: [{ leftOperand: recipientSet, operator: "isAnyOf", rightOperand: [h("a")] }],
  });

  it("a single allowed recipient still permits autonomously", async () => {
    expect(await evaluateIntent(m, intent(send, { [recipientSet]: h("a") }))).toEqual({
      decision: "permit",
      reason: "autonomous",
    });
  });

  it("an allowed recipient plus an outside one is not an autonomous permit", async () => {
    const d = await evaluateIntent(m, intent(send, { [recipientSet]: [h("a"), h("b")] }));
    expect(d.decision).not.toBe("permit");
  });

  it("the solid-odrl engine reports the set-valued operand as indeterminate", async () => {
    const effect = await solidOdrlEngine.evaluate(
      m.autonomous,
      intent(send, { [recipientSet]: [h("a"), h("b")] }),
    );
    expect(effect.effect).toBe("indeterminate");
  });
});

describe("set-valued operands cannot switch off a prohibition or satisfy a duty", () => {
  const recipientSet = `${AGENT}recipientSet`;
  const send = `${AGENT}SendMessage`;

  it("an isNoneOf prohibition is not bypassed by adding one listed recipient", async () => {
    const m = mandateWith({ type: "permission", action: send }, [
      {
        type: "prohibition",
        action: send,
        constraints: [{ leftOperand: recipientSet, operator: "isNoneOf", rightOperand: [h("a")] }],
      },
    ]);
    expect((await evaluateIntent(m, intent(send, { [recipientSet]: h("b") }))).decision).toBe(
      "prohibited",
    );
    const d = await evaluateIntent(m, intent(send, { [recipientSet]: [h("a"), h("b")] }));
    expect(d.decision).not.toBe("permit");
  });

  it("a duty's isAnyOf constraint is not satisfied by one matching element of a set", async () => {
    const m = mandateWith({
      type: "permission",
      action: send,
      duties: [
        {
          action: "inform",
          constraints: [{ leftOperand: "recipient", operator: "isAnyOf", rightOperand: [h("a")] }],
        },
      ],
    });
    const done = { "fulfilled:inform": true };
    expect((await evaluateIntent(m, intent(send, { recipient: h("a"), ...done }))).decision).toBe(
      "permit",
    );
    const d = await evaluateIntent(m, intent(send, { recipient: [h("a"), h("b")], ...done }));
    expect(d.decision).not.toBe("permit");
  });

  it("a prohibition copied out of its policy still covers a broader request", async () => {
    const prohibition: Rule = { type: "prohibition", action: "append" };
    const p = { id: "urn:p", prohibitions: [{ ...prohibition }] };
    // The rule passed in is a copy, not the array member: the explicit kind decides.
    expect(candidate(prohibition, p, intent("write"), "prohibition")).toBe(true);
    expect(candidate(prohibition, p, intent("write"), "permission")).toBe(false);
    // Without a kind, membership in p.prohibitions decides.
    expect(candidate(p.prohibitions[0] as Rule, p, intent("write"))).toBe(true);
    expect(candidate(prohibition, p, intent("write"))).toBe(false);
    expect(candidate({ type: "permission", action: "use" }, { id: "urn:q" }, intent("read"))).toBe(
      true,
    );
  });
});
