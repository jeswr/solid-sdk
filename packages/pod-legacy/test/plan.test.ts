// AUTHORED-BY Codex GPT-6.1-Sol
import { evaluate, parsePolicy, policyToTurtle } from "@jeswr/solid-odrl";
import { describe, expect, it } from "vitest";
import {
  boundedNow,
  DAY,
  dueDate,
  evaluatePlan,
  isLegacyTarget,
  isWebId,
  type LegacyPlan,
  planPolicy,
  proposedGrants,
  recordActivity,
  validPlan,
} from "../src/plan.js";
import { plan, root } from "./fixture.js";

it("uses UTC calendar months, clamping month ends across leap years", () => {
  const p = plan();
  p.inactivityMonths = 1;
  expect(dueDate(p)?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
  p.lastActivity = new Date("2024-01-31T12:00:00Z");
  expect(dueDate(p)?.toISOString()).toBe("2024-02-29T12:00:00.000Z");
  p.lastActivity = new Date("2025-12-31T12:00:00Z");
  expect(dueDate(p)?.toISOString()).toBe("2026-01-31T12:00:00.000Z");
});
it("transitions at exact warning and due instants, using ceil for partial days", () => {
  const p = plan();
  const due = (dueDate(p) as Date).getTime();
  expect(evaluatePlan(p, new Date(due - 31 * DAY))).toEqual({
    state: "active",
    nextCheck: new Date(due - 30 * DAY),
    daysUntilDue: 31,
  });
  expect(evaluatePlan(p, new Date(due - 30 * DAY))).toEqual({
    state: "warning",
    level: 1,
    nextCheck: new Date(due - 7 * DAY),
    daysUntilDue: 30,
  });
  expect(evaluatePlan(p, new Date(due - 7 * DAY))).toEqual({
    state: "warning",
    level: 2,
    nextCheck: new Date(due),
    daysUntilDue: 7,
  });
  expect(evaluatePlan(p, new Date(due - 1))).toMatchObject({ state: "warning", daysUntilDue: 1 });
  for (const now of [due, due + DAY])
    expect(evaluatePlan(p, new Date(now))).toEqual({
      state: "due",
      nextCheck: null,
      daysUntilDue: 0,
    });
  p.enabled = false;
  expect(evaluatePlan(p, new Date(due))).toEqual({
    state: "disabled",
    nextCheck: null,
    daysUntilDue: null,
  });
});
it("does not accelerate a future activity timestamp, tolerates long periods and duplicate warnings", () => {
  const p = plan();
  p.inactivityMonths = 120000;
  expect(evaluatePlan(p, new Date("2025-01-01"))).toMatchObject({ state: "active" });
  p.inactivityMonths = 6;
  p.warningDays = [7, 30, 30];
  expect(evaluatePlan(p, new Date("2026-07-01T12:00Z"))).toMatchObject({
    state: "warning",
    level: 1,
  });
  p.warningDays = [36600];
  expect(evaluatePlan(p, new Date("2025-12-01"))).toMatchObject({
    state: "active",
    nextCheck: p.lastActivity,
  });
  p.lastActivity = new Date(8640000000000000);
  expect(dueDate(p)).toBeNull();
});
it.each([
  undefined,
  null,
  1,
  "https://",
  "javascript:alert(1)",
  "https://a.example/evil>thing",
  "https://u:p@a.example/",
])("refuses invalid WebID %s", (value) => expect(isWebId(value)).toBe(false));
it("preserves exact HTTPS WebIDs", () => expect(isWebId("https://A.example/card#Me")).toBe(true));
const invalids: [string, unknown][] = [
  ["owner", null],
  ["storage", "https://alice.example"],
  ["storage", "https://alice.example/?x"],
  ["storage", "https://alice.example/#x"],
  ["storage", "https://alice.example/%2f/"],
  ["storage", "https://ALICE.example/"],
  ["enabled", "true"],
  ["created", null],
  ["modified", new Date("2024-01-01")],
  ["lastActivity", new Date("bad")],
  ["lastActivity", new Date("2024-01-01")],
  ["inactivityMonths", 0],
  ["inactivityMonths", 1.5],
  ["inactivityMonths", Infinity],
  ["inactivityMonths", 120001],
  ["warningDays", null],
  ["warningDays", []],
  ["warningDays", Array(11).fill(1)],
  ["warningDays", [0]],
  ["warningDays", [36601]],
  ["warningDays", [NaN]],
  ["notifyMeBy", undefined],
  ["notifyMeBy", []],
  ["notifyMeBy", ["email"]],
  ["notifyMeBy", ["settings", "tray", "settings"]],
  ["contacts", null],
  ["contacts", []],
  ["contacts", Array(51).fill(plan().contacts[0])],
];
describe("invalid records always fail closed", () => {
  it.each(invalids)("rejects %s = %s", (field, value) => {
    const p = { ...plan(), [field]: value } as LegacyPlan;
    expect(validPlan(p)).toBe(false);
    expect(evaluatePlan(p, new Date("2030-01-01"))).toMatchObject({
      state: "disabled",
      reason: "invalid-plan",
    });
    expect(proposedGrants(p)).toEqual([]);
    expect(recordActivity(p, new Date())).toBe(p);
  });
  it.each([
    null,
    { webId: "http://alex.example/" },
    { displayName: " " },
    { displayName: null },
    { mode: "write" },
    { scope: "other" },
    { targets: undefined },
    { targets: [] },
    { targets: Array(101).fill(root) },
    { targets: ["https://foreign.example/Photos/"] },
    { targets: [`${root}Photos/?q`] },
    { targets: [`${root}Photos/#x`] },
    { targets: [`${root}Photos/%25/`] },
    { targets: [root] },
    { scope: "whole-pod", targets: [`${root}Photos/Trips/`] },
    { scope: "whole-pod", targets: [root, root] },
  ])("rejects invalid contact %s", (fields) => {
    const p = plan();
    p.contacts = [
      fields === null ? null : { ...p.contacts[0], ...fields },
    ] as LegacyPlan["contacts"];
    expect(validPlan(p)).toBe(false);
    expect(evaluatePlan(p, new Date("2030-01-01")).state).toBe("disabled");
  });
  it("rejects missing plans and invalid clocks", () => {
    expect(validPlan(null as unknown as LegacyPlan)).toBe(false);
    expect(evaluatePlan(plan(), new Date("bad"))).toMatchObject({
      state: "disabled",
      reason: "invalid-plan",
    });
  });
});
it("previews read-only grants for whole pod and exact containers without applying anything", () => {
  const p = plan();
  p.enabled = false;
  expect(proposedGrants(p).map((g) => [g.target, g.grant.modes, g.inherit])).toEqual([
    [`${root}Photos/`, ["read"], true],
    [`${root}Documents/`, ["read"], true],
  ]);
  p.contacts[0]!.scope = "whole-pod";
  expect(proposedGrants(p).map((g) => g.target)).toEqual([`${root}Photos/`, `${root}Documents/`]);
  p.contacts[0]!.targets = [root];
  expect(proposedGrants(p)).toEqual([]);
});
it("records activity only after 24h, never moves backward, and never mutates the source", () => {
  const p = plan();
  const original = structuredClone(p);
  for (const time of [p.lastActivity.getTime() - DAY, p.lastActivity.getTime() + DAY - 1])
    expect(recordActivity(p, new Date(time))).toBe(p);
  expect(recordActivity(p, new Date("bad"))).toBe(p);
  const now = new Date(p.lastActivity.getTime() + DAY);
  const updated = recordActivity(p, now);
  expect(updated.lastActivity).toEqual(now);
  expect(updated.modified).toEqual(now);
  expect(p).toEqual(original);
  now.setFullYear(2000);
  expect(updated.lastActivity.getUTCFullYear()).toBe(2026);
  p.modified = new Date("2030-01-01");
  expect(recordActivity(p, new Date("2027-01-01"))).toBe(p);
});
it("round-trips standard constrained ODRL and cannot permit before the derived threshold", async () => {
  const p = plan();
  const policy = planPolicy(p, `${root}settings/legacy-plan.ttl#policy`);
  const parsed = await parsePolicy(await policyToTurtle(policy));
  expect(parsed).toBeDefined();
  const request = {
    agent: p.contacts[0]!.webId,
    action: "read" as const,
    target: `${root}Photos/`,
  };
  expect(evaluate(parsed!, request, { now: new Date("2026-07-31T11:59:59Z") }).decision).toBe(
    "notApplicable",
  );
  expect(evaluate(parsed!, request, { now: new Date("2026-07-31T12:00:00Z") }).decision).toBe(
    "permit",
  );
  expect(
    evaluate(
      parsed!,
      { ...request, agent: "https://other.example/#me" },
      { now: new Date("2030-01-01") },
    ).decision,
  ).toBe("notApplicable");
  p.enabled = false;
  expect(planPolicy(p, `${root}policy`).permissions).toEqual([]);
  expect(planPolicy({ ...p, contacts: [] }, `${root}policy`).permissions).toEqual([]);
  expect(() => planPolicy(p, "javascript:bad")).toThrow();
});
it("refuses sparse arrays and URL parser failures", () => {
  expect(isWebId("https://[invalid]/")).toBe(false);
  for (const [field, value] of [
    ["warningDays", new Array(1)],
    ["notifyMeBy", new Array(1)],
    ["contacts", new Array(1)],
  ] as const)
    expect(
      evaluatePlan({ ...plan(), [field]: value } as LegacyPlan, new Date("2030-01-01")).state,
    ).toBe("disabled");
  const p = plan();
  p.contacts[0]!.targets = new Array(1);
  expect(validPlan(p)).toBe(false);
});
it.each([
  root,
  `${root}settings/`,
  `${root}settings/private/`,
  `${root}settings/legacy-plan.ttl`,
  `${root}%73ettings/`,
  `${root}SETTINGS/`,
  `${root}%ZZ/`,
  "not-an-iri",
])("never proposes settings or an unsafe target %s", (target) => {
  expect(isLegacyTarget(target, root)).toBe(false);
  for (const scope of ["containers", "whole-pod"] as const) {
    const p = plan();
    p.contacts[0]!.scope = scope;
    p.contacts[0]!.targets = [target];
    expect(validPlan(p)).toBe(false);
    expect(proposedGrants(p)).toEqual([]);
  }
});
it("validates roots and preserves unrelated folder names", () => {
  expect(isLegacyTarget(`${root}Photos/`, "invalid")).toBe(false);
  expect(isLegacyTarget(`${root}settings-backup/`, root)).toBe(true);
  expect(isLegacyTarget(`${root}Photos/Trips/`, root)).toBe(true);
});
it("allows empty contacts only while disabled", () => {
  const p = { ...plan(), enabled: false, contacts: [] };
  expect(validPlan(p)).toBe(true);
  expect(evaluatePlan(p, new Date("2030-01-01")).state).toBe("disabled");
  expect(proposedGrants(p)).toEqual([]);
  expect(validPlan({ ...p, enabled: true })).toBe(false);
});
it("bounds fast heartbeat clocks at five minutes and refuses missing server time", () => {
  const p = plan();
  const server = new Date("2026-06-01T12:00:00Z");
  const limit = new Date(server.getTime() + 300_000);
  expect(recordActivity(p, new Date("2035-01-01"), server).lastActivity).toEqual(limit);
  expect(recordActivity(p, limit, server).lastActivity).toEqual(limit);
  expect(recordActivity(p, server, server).lastActivity).toEqual(server);
  expect(recordActivity(p, server, new Date(NaN))).toBe(p);
  expect(boundedNow(new Date(NaN), server).getTime()).toBeNaN();
});
it("ODRL container targets do not authorize descendants or settings", () => {
  const p = plan();
  p.contacts[0]!.scope = "whole-pod";
  const policy = planPolicy(p, `${root}policy`);
  for (const target of [
    root,
    `${root}Photos/photo.jpg`,
    `${root}settings/`,
    `${root}settings/legacy-plan.ttl`,
  ])
    expect(
      evaluate(
        policy,
        { action: "read", target, agent: p.contacts[0]!.webId },
        { now: new Date("2030-01-01") },
      ).decision,
    ).toBe("notApplicable");
});
