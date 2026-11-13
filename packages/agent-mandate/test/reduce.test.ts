// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { evaluateIntent } from "../src/policy.js";
import { reissueMandate, removePermission } from "../src/reduce.js";
import { AGENT, type Mandate, type Rule } from "../src/types.js";
import { ACTOR, HASH, mandate, NOW } from "./helpers.js";

const known = ["SendMessage", "Remember", "BookAppointment"].map((a) => `${AGENT}${a}`);
const opts = { knownActions: known, now: NOW };
const send = (extra: Partial<Rule> = {}): Rule => ({
  type: "permission",
  action: `${AGENT}SendMessage`,
  constraints: [
    { leftOperand: `${AGENT}recipientSet`, operator: "isAnyOf", rightOperand: [HASH] },
    { leftOperand: `${AGENT}binding`, operator: "isAnyOf", rightOperand: ["gmail"] },
  ],
  ...extra,
});
const remember: Rule = { type: "permission", action: `${AGENT}Remember` };
const intent = (action = `${AGENT}SendMessage`, binding = "gmail") => ({
  agent: ACTOR,
  action,
  target: ACTOR,
  at: NOW.toISOString(),
  attributes: { [`${AGENT}binding`]: binding, [`${AGENT}recipientSet`]: HASH },
});
const source = (auto: Rule[], ask: Rule[]): Mandate => ({
  ...mandate(),
  validFrom: new Date(NOW.getTime() - 1000).toISOString(),
  autonomous: { id: "urn:auto", permissions: auto },
  withApproval: { id: "urn:ask", permissions: ask },
});

describe("reissueMandate", () => {
  it("gives a fresh identity and never moves validFrom earlier", () => {
    const m = source([], []);
    const next = reissueMandate(m, "urn:next", NOW);
    expect(next.id).toBe("urn:next");
    expect(next.autonomous.id).toBe("urn:next/autonomous");
    expect(next.withApproval.id).toBe("urn:next/with-approval");
    expect(next.validFrom).toBe(NOW.toISOString());
    expect(next.validUntil).toBe(m.validUntil);
    expect(next.prohibitions).toBe(m.prohibitions);
    expect(next.limits).toBe(m.limits);
    const later = { ...m, validFrom: new Date(NOW.getTime() + 5000).toISOString() };
    expect(reissueMandate(later, "urn:next", NOW).validFrom).toBe(later.validFrom);
    expect(Date.parse(reissueMandate(m, "urn:next").validFrom)).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
  });
});

describe("removePermission", () => {
  it("demotes an automatic rule and its same-action overlaps to ask first", async () => {
    const m = source([send(), send({ id: "urn:rule" }), remember], [send()]);
    const next = await removePermission(m, "autonomous", 0, "urn:next", opts);
    expect(next.autonomous.permissions).toEqual([remember]);
    expect(next.withApproval.permissions).toEqual([send(), send(), send({ id: "urn:rule" })]);
    expect(next.prohibitions).toBe(m.prohibitions);
    expect(await evaluateIntent(next, intent())).toEqual({
      decision: "confirm-required",
      reason: "owner-approval",
    });
    expect((await evaluateIntent(next, intent(`${AGENT}Remember`))).decision).toBe("permit");
    const bare = await removePermission(
      { ...m, withApproval: { id: "urn:ask" } },
      "autonomous",
      0,
      "urn:next",
      opts,
    );
    expect(bare.withApproval.permissions).toEqual([send(), send({ id: "urn:rule" })]);
  });

  it("turns an ask-first rule into a ban at the same scope and drops automatic overlaps", async () => {
    const m = source([send()], [send({ id: "urn:selected" }), remember]);
    const next = await removePermission(m, "withApproval", 0, "urn:next", opts);
    expect(next.autonomous.permissions).toEqual([]);
    expect(next.withApproval.permissions).toEqual([remember]);
    expect(next.prohibitions).toEqual([...m.prohibitions, { ...send(), type: "prohibition" }]);
    expect(next.prohibitions.at(-1)).not.toHaveProperty("id");
    expect(await evaluateIntent(next, intent())).toEqual({
      decision: "prohibited",
      reason: "prohibition",
    });
    // Outside the removed rule's scope the default (ask first) still applies.
    expect((await evaluateIntent(next, intent(`${AGENT}SendMessage`, "matrix"))).decision).toBe(
      "confirm-required",
    );
    const bare = await removePermission(
      { ...m, autonomous: { id: "urn:auto" } },
      "withApproval",
      1,
      "urn:next",
      { knownActions: known },
    );
    expect(bare.autonomous.permissions).toEqual([]);
    expect(bare.withApproval.permissions).toEqual([send({ id: "urn:selected" })]);
  });

  it("refuses stale indexes, unknown actions and rules the engine can't fully evaluate", async () => {
    const m = source([send()], [send()]);
    for (const index of [-1, 0.5, 2])
      await expect(removePermission(m, "withApproval", index, "urn:next", opts)).rejects.toThrow(
        "changed",
      );
    await expect(
      removePermission({ ...m, autonomous: { id: "urn:auto" } }, "autonomous", 0, "urn:n", opts),
    ).rejects.toThrow("changed");
    await expect(
      removePermission(m, "withApproval", 0, "urn:next", { knownActions: [], now: NOW }),
    ).rejects.toThrow("Edit this rule");
    const odd = send({
      constraints: [{ leftOperand: "urn:unknown", operator: "eq", rightOperand: 1 }],
    });
    await expect(
      removePermission(source([], [odd]), "withApproval", 0, "urn:next", opts),
    ).rejects.toThrow("Edit this rule");
    // An unsupported automatic overlap blocks the removal too.
    await expect(
      removePermission(source([odd], [send()]), "withApproval", 0, "urn:next", opts),
    ).rejects.toThrow("Edit this rule");
  });
});
