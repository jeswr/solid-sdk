// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { solidOdrlEngine } from "../src/policy.js";
import { autonomousTargets } from "../src/scope.js";
import type { Intent, Mandate, Rule } from "../src/types.js";
import { intent, mandate, NOW } from "./helpers.js";

const PREF = "https://w3id.org/dpv/pd#Preference";
const HEALTH = "https://w3id.org/dpv/pd#Health";
const purpose = "https://w3id.org/dpv#Personalisation";
const rule = (target?: string): Rule => ({
  type: "permission",
  action: "read",
  ...(target === undefined ? {} : { target }),
  constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: purpose }],
});
const request = (patch: Partial<Intent> = {}) =>
  intent({ action: "read", attributes: { purpose }, ...patch });
function scoped(permissions: readonly Rule[] = [rule(PREF)]): Mandate {
  const m = mandate();
  return {
    ...m,
    autonomous: { ...m.autonomous, permissions },
    withApproval: { ...m.withApproval, permissions: [] },
  };
}
it("returns sorted unique exact autonomous targets, including full odrl:read requests", async () => {
  expect(
    await autonomousTargets(scoped([rule(HEALTH), rule(PREF)]), request(), [PREF, HEALTH, PREF]),
  ).toEqual([HEALTH, PREF]);
  expect(
    await autonomousTargets(scoped(), request({ action: "http://www.w3.org/ns/odrl/2/read" }), [
      PREF,
    ]),
  ).toEqual([PREF]);
  expect(
    await autonomousTargets(
      scoped([{ type: "permission", action: "read", target: PREF }]),
      request({ attributes: undefined }),
      [PREF],
    ),
  ).toEqual([PREF]);
});
it("denies absent, empty, untargeted, wildcard and collection permissions", async () => {
  for (const m of [
    undefined,
    scoped([]),
    { ...scoped(), autonomous: { id: "urn:empty" } },
    scoped([rule()]),
    scoped([rule("*")]),
    scoped([rule("https://example.org/collection/")]),
  ])
    expect(await autonomousTargets(m, request(), [PREF])).toEqual([]);
  expect(await autonomousTargets(scoped(), request({ action: "write" }), [PREF])).toEqual([]);
  const wildcards = ["*", "https://example.org/collection/*"];
  expect(await autonomousTargets(scoped(wildcards.map(rule)), request(), wildcards)).toEqual([]);
});
it("prohibition, approval-only, purpose, agent and validity checks all refuse recall", async () => {
  const m = scoped();
  expect(
    await autonomousTargets(
      { ...m, prohibitions: [{ type: "prohibition", action: "read", target: PREF }] },
      request(),
      [PREF],
    ),
  ).toEqual([]);
  expect(
    await autonomousTargets(
      {
        ...m,
        autonomous: { ...m.autonomous, permissions: [] },
        withApproval: { ...m.withApproval, permissions: [rule(PREF)] },
      },
      request(),
      [PREF],
    ),
  ).toEqual([]);
  for (const req of [
    request({ agent: "urn:wrong" }),
    request({ at: new Date(NOW.getTime() + 40 * 86400000).toISOString() }),
    request({ attributes: { purpose: "urn:wrong" } }),
    request({ attributes: { purpose: [purpose] } }),
    request({ attributes: { purpose: 1 } }),
  ])
    expect(await autonomousTargets(m, req, [PREF])).toEqual([]);
});
it("an untargeted permit cannot launder an exact grant with a failing purpose", async () => {
  expect(
    await autonomousTargets(
      scoped([{ type: "permission", action: "read" }, rule(PREF)]),
      request({ attributes: { purpose: "urn:wrong" } }),
      [PREF],
    ),
  ).toEqual([]);
});
it("snapshots purpose once so accessors cannot substitute an array during evaluation", async () => {
  let reads = 0;
  const attributes = {
    get purpose() {
      return ++reads === 1 ? purpose : [purpose];
    },
  };
  expect(await autonomousTargets(scoped(), request({ attributes }), [PREF])).toEqual([PREF]);
  expect(reads).toBe(1);
});
it("passes trusted attributes through the injected engine and catches its failures", async () => {
  let calls = 0;
  const engine = {
    id: "fixture",
    evaluate: (p: Parameters<typeof solidOdrlEngine.evaluate>[0], q: Intent) => {
      calls++;
      expect(q.action).toBe("read");
      expect(q.attributes?.purpose).toBe(purpose);
      return solidOdrlEngine.evaluate(p, q);
    },
  };
  expect(await autonomousTargets(scoped(), request(), [PREF], engine)).toEqual([PREF]);
  expect(calls).toBe(6);
  expect(
    await autonomousTargets(scoped(), request(), [PREF], {
      id: "broken",
      evaluate() {
        throw Error("private");
      },
    }),
  ).toEqual([]);
});
