// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  dryRunRules,
  evaluateRules,
  type MailAction,
  type MailCondition,
  type MailMessage,
  type MailRule,
  MailRulesError,
  validateRules,
} from "../src/apps/mail/lib/rules";

const message: MailMessage = {
  from: ["Mira Vale <mira@example.org>", "robot@example.org"],
  to: ["dev@example.org", "Ivo Reed <ivo@example.org>"],
  subject: "Project [news]",
  body: "Hello Mira\nAn update from the fictional team.",
  hasAttachment: true,
  size: 2048,
};
const yes: MailCondition = { field: "subject", operator: "contains", value: "Project" };
const no: MailCondition = { field: "subject", operator: "equals", value: "Missing" };
function rule(
  id = "rule-1",
  condition: MailCondition = yes,
  actions: readonly MailAction[] = [{ type: "star" }],
): MailRule {
  return { id, condition, actions };
}
function match(condition: MailCondition, item = message): boolean {
  return dryRunRules(item, [rule("rule-1", condition)]).rules[0]?.matched === true;
}
function rejects(run: () => unknown, code: MailRulesError["code"]): void {
  expect(run).toThrow(MailRulesError);
  expect(run).toThrow(expect.objectContaining({ name: "MailRulesError", code }));
}
function invalidRule(value: unknown): void {
  rejects(() => validateRules(value), "invalid-rule");
}
function badCondition(value: unknown): void {
  invalidRule([{ ...rule(), condition: value }]);
}
function badActions(value: unknown): void {
  invalidRule([{ ...rule(), actions: value }]);
}

describe("mail condition matching", () => {
  it.each([
    ["from", "equals", "robot@example.org", true],
    ["from", "equals", "mira@example.org", false],
    ["from", "contains", "mira@example.org", true],
    ["to", "equals", "dev@example.org", true],
    ["to", "contains", "ivo@example.org", true],
    ["to", "contains", "@elsewhere.example.org", false],
    ["subject", "equals", "Project [news]", true],
    ["subject", "equals", "Project", false],
    ["subject", "contains", "[news]", true],
    ["subject", "contains", ".*", false],
    ["subject", "contains", "project", false],
    ["subject", "equals", " Project [news]", false],
    ["body", "contains", "Mira\nAn", true],
    ["body", "equals", message.body, true],
    ["body", "contains", "<b>", false],
  ] as const)("%s %s %s => %s", (field, operator, value, expected) => {
    expect(match({ field, operator, value })).toBe(expected);
  });

  it("does not normalize Unicode, concatenate addresses, or parse body markup", () => {
    expect(
      match(
        { field: "subject", operator: "equals", value: "é" },
        { ...message, subject: "e\u0301" },
      ),
    ).toBe(false);
    expect(match({ field: "to", operator: "contains", value: "orgIvo" })).toBe(false);
    expect(
      match(
        { field: "body", operator: "equals", value: "Hello" },
        { ...message, body: "<b>Hello</b>" },
      ),
    ).toBe(false);
    expect(match(yes, { ...message, from: [], to: [], body: "", subject: "" })).toBe(false);
    expect(
      match({ field: "to", operator: "contains", value: "example" }, { ...message, to: [] }),
    ).toBe(false);
  });

  it.each([true, false])("matches attachment value %s exactly", (value) => {
    expect(match({ field: "has-attachment", value })).toBe(value);
    expect(match({ field: "has-attachment", value }, { ...message, hasAttachment: false })).toBe(
      !value,
    );
  });

  it.each([
    ["equals", 2048, true],
    ["equals", 2047, false],
    ["greater-than", 2047, true],
    ["greater-than", 2048, false],
    ["greater-than", 2049, false],
    ["less-than", 2049, true],
    ["less-than", 2048, false],
    ["less-than", 2047, false],
  ] as const)("size %s %i => %s", (operator, value, expected) => {
    expect(match({ field: "size", operator, value })).toBe(expected);
  });

  it("supports zero and the maximum safe byte size", () => {
    for (const size of [0, Number.MAX_SAFE_INTEGER]) {
      expect(match({ field: "size", operator: "equals", value: size }, { ...message, size })).toBe(
        true,
      );
    }
  });

  it("combines nested nonempty all/any groups", () => {
    expect(match({ match: "all", conditions: [yes, yes] })).toBe(true);
    expect(match({ match: "all", conditions: [yes, no] })).toBe(false);
    expect(match({ match: "any", conditions: [no, yes] })).toBe(true);
    expect(match({ match: "any", conditions: [no, no] })).toBe(false);
    expect(
      match({ match: "all", conditions: [yes, { match: "any", conditions: [no, yes] }] }),
    ).toBe(true);
  });
});

describe("mail evaluation and dry-run", () => {
  it("returns a neutral plan for empty rules and for no matches", () => {
    const plan = { labels: [], moveTo: null, markRead: false, star: false, stoppedByRuleId: null };
    expect(dryRunRules(message, [])).toEqual({ rules: [], plan });
    expect(dryRunRules(message, [rule("miss", no)])).toEqual({
      rules: [{ ruleId: "miss", matched: false, applied: false }],
      plan,
    });
  });

  it("applies all positive actions in array order and deduplicates labels", () => {
    const rules = [
      rule("z-first", yes, [
        { type: "label", label: "Work" },
        { type: "move", folder: "archive" },
      ]),
      rule("a-second", yes, [
        { type: "label", label: "News" },
        { type: "label", label: "Work" },
        { type: "mark-read" },
        { type: "star" },
        { type: "move", folder: "archive" },
      ]),
    ];
    const result = dryRunRules(message, rules);
    expect(result.rules).toEqual([
      { ruleId: "z-first", matched: true, applied: true },
      { ruleId: "a-second", matched: true, applied: true },
    ]);
    expect(result.plan).toEqual({
      labels: ["Work", "News"],
      moveTo: "archive",
      markRead: true,
      star: true,
      stoppedByRuleId: null,
    });
    expect(evaluateRules(message, rules)).toEqual(result.plan);
  });

  it("stops after the entire matching rule, but still reports later matches", () => {
    const rules = [
      rule("miss", no, [{ type: "stop-processing" }]),
      rule("stop", yes, [
        { type: "stop-processing" },
        { type: "label", label: "Keep" },
        { type: "mark-read" },
        { type: "move", folder: "keep" },
      ]),
      rule("later-match", yes, [{ type: "move", folder: "other" }]),
      rule("later-miss", no),
    ];
    expect(dryRunRules(message, rules)).toEqual({
      rules: [
        { ruleId: "miss", matched: false, applied: false },
        { ruleId: "stop", matched: true, applied: true },
        { ruleId: "later-match", matched: true, applied: false },
        { ruleId: "later-miss", matched: false, applied: false },
      ],
      plan: {
        labels: ["Keep"],
        moveTo: "keep",
        markRead: true,
        star: false,
        stoppedByRuleId: "stop",
      },
    });
    rejects(() => dryRunRules(message, [...rules].reverse()), "contradictory-actions");
  });

  it("rejects contradictory moves within a rule and between applied matches", () => {
    const a: MailAction = { type: "move", folder: "a" };
    const b: MailAction = { type: "move", folder: "b" };
    rejects(() => validateRules([rule("bad", no, [a, b])]), "contradictory-actions");
    rejects(
      () => evaluateRules(message, [rule("a", yes, [a]), rule("b", yes, [b])]),
      "contradictory-actions",
    );
    expect(evaluateRules(message, [rule("a", yes, [a, a]), rule("b", no, [b])]).moveTo).toBe("a");
  });

  it("validates rules after stop and all children before short-circuit matching", () => {
    const stop = rule("stop", yes, [{ type: "stop-processing" }]);
    rejects(
      () => evaluateRules(message, [stop, { ...rule("invalid"), actions: [] }]),
      "invalid-rule",
    );
    for (const first of [yes, no]) {
      for (const combine of ["all", "any"]) {
        badCondition({ match: combine, conditions: [first, { field: "unknown" }] });
      }
    }
  });

  it("never mutates inputs or shares mutable output arrays", () => {
    const rules = [rule("one", yes, [{ type: "label", label: "Example" }])];
    const before = JSON.stringify({ message, rules });
    const freeze = (value: unknown): void => {
      if (typeof value === "object" && value !== null) {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
      }
    };
    freeze(message);
    freeze(rules);
    const result = dryRunRules(message, rules);
    (result.plan.labels as string[]).push("Local edit");
    expect(evaluateRules(message, rules).labels).toEqual(["Example"]);
    expect(JSON.stringify({ message, rules })).toBe(before);
  });
});

describe("fail-closed validation", () => {
  it.each([
    null,
    undefined,
    1,
    "message",
    [],
    new Date(),
    { extra: true },
  ])("rejects malformed message %j", (value) => {
    rejects(() => evaluateRules(value as unknown as MailMessage, []), "invalid-message");
  });

  it("rejects missing, unknown, and mistyped message fields", () => {
    for (const key of Object.keys(message)) {
      const missing = { ...message } as Record<string, unknown>;
      delete missing[key];
      rejects(() => evaluateRules(missing as unknown as MailMessage, []), "invalid-message");
    }
    const patches = [
      { extra: "unsupported" },
      { from: "mira@example.org" },
      { to: [null] },
      { from: [""] },
      { to: ["   "] },
      { subject: null },
      { body: 2 },
      { hasAttachment: "true" },
      { hasAttachment: 1 },
      ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10"].map((size) => ({ size })),
    ];
    for (const patch of patches) {
      rejects(() => evaluateRules({ ...message, ...patch } as MailMessage, []), "invalid-message");
    }
  });

  it("rejects non-data records without invoking getters", () => {
    const getter = { ...rule() };
    Object.defineProperty(getter, "id", {
      enumerable: true,
      get: () => {
        throw new Error("must not read");
      },
    });
    invalidRule([getter]);
    invalidRule([Object.defineProperty({ ...rule() }, "hidden", { value: 1 })]);
    invalidRule([{ ...rule(), [Symbol("extra")]: true }]);
    invalidRule([Object.create({ ...rule() })]);
    expect(() => validateRules([Object.assign(Object.create(null), rule())])).not.toThrow();
  });

  it("accepts plain dense arrays and rejects holes, extras, symbols and accessors", () => {
    invalidRule(new Array(1));
    invalidRule(Object.setPrototypeOf([rule()], null));
    invalidRule(
      Object.setPrototypeOf([rule()], { [Symbol.iterator]: () => [][Symbol.iterator]() }),
    );
    invalidRule(Object.assign(new Array(1), { extra: true }));
    invalidRule(Object.assign([], { extra: true }));
    invalidRule(Object.assign([], { [Symbol("extra")]: true }));
    const accessor: unknown[] = [rule()];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get: () => {
        throw new Error("must not read");
      },
    });
    invalidRule(accessor);
    const hidden = [rule()];
    Object.defineProperty(hidden, "0", { enumerable: false });
    invalidRule(hidden);
    invalidRule(null);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { ...rule(), id: "" },
    { ...rule(), id: " " },
    { ...rule(), id: 1 },
    { ...rule(), extra: true },
  ])("rejects malformed rule %j", (value) => invalidRule([value]));

  it("rejects duplicate IDs", () => invalidRule([rule(), rule()]));

  it.each([
    null,
    {},
    [],
    { match: "none", conditions: [yes] },
    { match: "all", conditions: [] },
    { match: "any", conditions: null },
    { match: "all", conditions: [yes], field: "body" },
    { field: "has-attachment", value: "true" },
    { field: "has-attachment", value: true, operator: "equals" },
    { field: "unknown", operator: "equals", value: "text" },
    { field: "body", operator: "regex", value: "text" },
    { field: "body", operator: "equals", value: "" },
    { field: "body", operator: "contains", value: 1 },
    { field: "body", operator: "contains", value: "x", caseSensitive: false },
    { field: "size", operator: "at-least", value: 1 },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"].map((value) => ({
      field: "size",
      operator: "equals",
      value,
    })),
  ])("rejects malformed condition %j", badCondition);

  it("rejects cyclic and excessively nested groups with typed errors", () => {
    const cycle = { match: "all", conditions: [] as unknown[] };
    cycle.conditions.push(cycle);
    badCondition(cycle);
    let nested: MailCondition = yes;
    for (let depth = 0; depth < 32; depth++) nested = { match: "all", conditions: [nested] };
    expect(() => validateRules([rule("bounded", nested)])).not.toThrow();
    badCondition({ match: "any", conditions: [nested] });
  });

  it.each([
    null,
    [],
    [null],
    [{}],
    [{ type: "delete" }],
    [{ type: "label", label: "" }],
    [{ type: "label", label: 1 }],
    [{ type: "move", folder: "  " }],
    [{ type: "move", folder: null }],
    [{ type: "label", label: "Work", folder: "archive" }],
    [{ type: "star", value: false }],
    [{ type: "mark-read", label: "Extra" }],
    [{ type: "stop-processing", folder: "Extra" }],
  ])("rejects malformed actions %j", badActions);
});
