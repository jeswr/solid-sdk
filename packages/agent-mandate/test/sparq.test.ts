// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal } from "@rdfjs/types";
import { expect, it, vi } from "vitest";
import { evaluateIntent, solidOdrlEngine } from "../src/policy.js";
import { node } from "../src/rdf.js";
import {
  type ProcessOptions,
  type ProcessResult,
  SPARQ_DECIDE_API,
  sparqPolicyEngine,
} from "../src/sparq.js";
import type { Constraint, Policy, Rule } from "../src/types.js";
import { AGENT, ODRL } from "../src/types.js";
import { ACTOR, intent, mandate } from "./helpers.js";

const policy: Policy = { id: "urn:policy", permissions: [{ type: "permission", action: "read" }] };
const response = (extra = {}): string =>
  JSON.stringify({
    api: SPARQ_DECIDE_API,
    evaluator: { crate: "sparq-policy", version: "0.1.0", function: "decide" },
    effect: "permit",
    matchedRules: [],
    ...extra,
  });
const engine = (stdout: string, extra: Partial<ProcessResult> = {}) =>
  sparqPolicyEngine({ binary: "test-binary", run: () => ({ stdout, status: 0, ...extra }) });
it("maps the pilot protocol decisions without engine fallback", async () => {
  for (const [effect, matchedRules, expected] of [
    ["permit", [], "permit"],
    ["deny", ["urn:rule"], "prohibited"],
    ["deny", [], "not-applicable"],
    ["indeterminate", [], "indeterminate"],
    ["unexpected", [], "indeterminate"],
  ] as const)
    expect(await engine(response({ effect, matchedRules })).evaluate(policy, intent())).toEqual({
      effect: expected,
    });
});
it("bounds subprocess inputs and handles every failure as indeterminate", async () => {
  for (const e of [
    sparqPolicyEngine(),
    sparqPolicyEngine({ binary: "/does-not-exist/sparq-policy-decide" }),
    engine("bad-json"),
    engine(response(), { error: new Error("timeout") }),
    engine(response(), { status: null }),
    engine("x".repeat(65537)),
    engine("null"),
    ...[
      { api: "wrong" },
      { error: "failed" },
      { evaluator: {} },
      { evaluator: { crate: "sparq-policy", function: "other" } },
      { evaluator: { crate: "sparq-policy", function: "decide", version: 5 } },
      { matchedRules: null },
      { matchedRules: [5] },
    ].map((p) => engine(response(p))),
    sparqPolicyEngine({
      binary: "test",
      run() {
        throw new Error("failed");
      },
    }),
  ])
    expect(await e.evaluate(policy, intent())).toEqual({ effect: "indeterminate" });
  expect(await engine(response()).evaluate(policy, intent({ target: "x".repeat(300000) }))).toEqual(
    { effect: "indeterminate" },
  );
  for (const p of [
    { ...policy, conflict: "perm" as const },
    { ...policy, obligations: [{ action: "inform" as const }] },
    {
      ...policy,
      permissions: [
        { type: "permission" as const, action: "read", duties: [{ action: "inform" as const }] },
      ],
    },
  ])
    expect(await engine(response()).evaluate(p, intent())).toEqual({ effect: "indeterminate" });
});
it("sends typed context, explicit process limits, and only this agent's rules", async () => {
  let captured: ProcessOptions | undefined;
  const e = sparqPolicyEngine({
    binary: "test",
    timeoutMs: 42,
    run(binary, args) {
      expect(binary).toBe("test");
      captured = args;
      return { stdout: response(), status: 0 };
    },
  });
  expect(
    await e.evaluate(
      {
        ...policy,
        assignee: ACTOR,
        prohibitions: [{ type: "prohibition", action: "read", assignee: "urn:other" }],
      },
      intent({
        action: "read",
        attributes: {
          purpose: "urn:purpose",
          count: 4,
          binding: "gmail",
          "https://example.org/operand": "value",
        },
      }),
    ),
  ).toEqual({ effect: "permit" });
  expect(captured).toMatchObject({ timeout: 42, maxBuffer: 65536, shell: false, env: {} });
  const doc = JSON.parse(captured?.input as string);
  expect(doc.request.action).toBe(`${ODRL}use`);
  expect(doc.policy.text).not.toContain("urn:other");
  expect(doc.request.context.map((c: { value: { type: string } }) => c.value.type)).toEqual([
    "iri",
    "decimal",
    "string",
    "string",
    "dateTime",
  ]);
  expect(
    await e.evaluate(
      { id: "urn:empty" },
      intent({ action: "https://example.org/Action", attributes: undefined }),
    ),
  ).toEqual({ effect: "permit" });
});
it("rejects unbounded timeouts and permits carrying unresolved context", async () => {
  for (const timeoutMs of [0, -1, Number.NaN, 30001])
    expect(
      await sparqPolicyEngine({ binary: "unused", timeoutMs }).evaluate(policy, intent()),
    ).toEqual({ effect: "indeterminate" });
  expect(
    await engine(response({ unresolved: [{ leftOperand: "purpose" }] })).evaluate(policy, intent()),
  ).toEqual({ effect: "indeterminate" });
  expect(await engine(response({ unresolved: [] })).evaluate(policy, intent())).toEqual({
    effect: "permit",
  });
});
it.each([
  "append",
  "control",
  `${AGENT}SendMessage`,
])("lowers matched actions while preserving shared context identities: %s", async (action) => {
  let input = "";
  await sparqPolicyEngine({
    binary: "test",
    run(_binary, args) {
      input = args.input;
      return { stdout: response(), status: 0 };
    },
  }).evaluate(
    {
      id: "urn:policy",
      permissions: [
        {
          type: "permission",
          action,
          constraints: [{ leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 }],
        },
      ],
    },
    intent({ action, attributes: { delegationDepth: 1, [`${AGENT}binding`]: "gmail" } }),
  );
  const doc = JSON.parse(input);
  expect(doc.request.action).toBe(`${ODRL}use`);
  expect(doc.request.context[0].leftOperand).toBe(
    "https://w3id.org/jeswr/odrl-delegation#delegationDepth",
  );
  expect(doc.request.context[1].leftOperand).toBe(`${AGENT}binding`);
  const store = await parseRdf(doc.policy.text, "text/turtle");
  const rule = node(store, "urn:example:sparq-envelope")
    .one("https://www.w3.org/2018/credentials#credentialSubject")
    .one(`${AGENT}policy`)
    .one(`${ODRL}permission`);
  expect(rule.iri(`${ODRL}action`)).toBe(`${ODRL}use`);
  expect(rule.one(`${ODRL}constraint`).iri(`${ODRL}leftOperand`)).toBe(
    "https://w3id.org/jeswr/odrl-delegation#delegationDepth",
  );
});

it.each([
  ["use", "read", true],
  ["use", "append", true],
  ["write", "append", true],
  ["append", "write", false],
  ["read", "write", false],
  ...[
    "control",
    "grantUse",
    "nextPolicy",
    "transfer",
    `${AGENT}SendMessage`,
    `${AGENT}Transfer`,
    `${AGENT}Sign`,
    `${AGENT}BookAppointment`,
  ].flatMap(
    (action) =>
      [
        ["use", action, false],
        [action, action, true],
        [action, "read", false],
      ] as const,
  ),
  [`${AGENT}SendMessage`, `${AGENT}Transfer`, false],
  ["use", "https://example.org/Action", false],
] as const)("filters %s rules for %s before backend matching (match: %s)", async (action, requested, matches) => {
  for (const type of ["permission", "prohibition"] as const) {
    let input = "";
    const rule: Rule = {
      type,
      action,
      target: intent().target,
      assignee: ACTOR,
      constraints: [{ leftOperand: "count", operator: "lteq", rightOperand: 4 }],
    };
    await sparqPolicyEngine({
      binary: "test",
      run(_binary, args) {
        input = args.input;
        return { stdout: response(), status: 0 };
      },
    }).evaluate(
      { id: policy.id, [type === "permission" ? "permissions" : "prohibitions"]: [rule] },
      intent({ action: requested, attributes: { count: 4 } }),
    );
    const doc = JSON.parse(input);
    const store = await parseRdf(doc.policy.text, "text/turtle");
    const serialized = node(store, "urn:example:sparq-envelope")
      .one("https://www.w3.org/2018/credentials#credentialSubject")
      .one(`${AGENT}policy`)
      .values(`${ODRL}${type}`);
    expect(serialized).toHaveLength(matches ? 1 : 0);
    expect(doc.request.action).toBe(`${ODRL}use`);
    for (const lowered of serialized) {
      expect(lowered.iri(`${ODRL}action`)).toBe(`${ODRL}use`);
      expect(lowered.iri(`${ODRL}target`)).toBe(rule.target);
      expect(lowered.values(`${ODRL}assignee`)).toHaveLength(0);
      expect(lowered.one(`${ODRL}constraint`).text(`${ODRL}rightOperand`)).toBe("4");
    }
  }
});

it("filters targets and inherited assignees before removing parties", async () => {
  let input = "";
  await sparqPolicyEngine({
    binary: "test",
    run(_binary, args) {
      input = args.input;
      return { stdout: response(), status: 0 };
    },
  }).evaluate(
    {
      id: policy.id,
      assignee: "urn:other",
      permissions: [
        { type: "permission", action: "read" },
        { type: "permission", action: "read", assignee: ACTOR, target: "urn:other-target" },
        { type: "permission", action: "read", assignee: ACTOR },
      ],
      prohibitions: [{ type: "prohibition", action: "read" }],
    },
    intent({ action: "read" }),
  );
  const store = await parseRdf(JSON.parse(input).policy.text, "text/turtle");
  const serialized = node(store, "urn:example:sparq-envelope")
    .one("https://www.w3.org/2018/credentials#credentialSubject")
    .one(`${AGENT}policy`);
  expect(serialized.values(`${ODRL}permission`)).toHaveLength(1);
  expect(serialized.values(`${ODRL}prohibition`)).toHaveLength(0);
});

const XSD = "http://www.w3.org/2001/XMLSchema#";
it.each<{
  name: string;
  constraint: Constraint;
  datatype?: string;
}>([
  {
    name: "inferred request-time bound",
    constraint: { leftOperand: "dateTime", operator: "lt", rightOperand: "2026-10-27T00:00:00Z" },
    datatype: `${XSD}dateTime`,
  },
  {
    name: "explicit temporal bound",
    constraint: {
      leftOperand: "dateTime",
      operator: "gteq",
      rightOperand: "2026-10-26T07:00:00-05:00",
      datatype: `${XSD}dateTime`,
    },
    datatype: `${XSD}dateTime`,
  },
  {
    name: "explicit date overrides time inference",
    constraint: {
      leftOperand: "dateTime",
      operator: "lt",
      rightOperand: "2026-10-27",
      datatype: `${XSD}date`,
    },
    datatype: `${XSD}date`,
  },
  {
    name: "inferred temporal singleton",
    constraint: {
      leftOperand: "dateTime",
      operator: "eq",
      rightOperand: ["2026-10-26T12:00:00Z"],
    },
    datatype: `${XSD}dateTime`,
  },
  ...["integer", "decimal", "double", "float"].map((datatype) => ({
    name: `declared ${datatype} with lexical operands`,
    constraint: {
      leftOperand: "count",
      operator: "eq" as const,
      rightOperand: ["+0002"],
      datatype: `${XSD}${datatype}`,
    },
    datatype: `${XSD}${datatype}`,
  })),
  {
    name: "every member of a declared string set",
    constraint: {
      leftOperand: `${AGENT}binding`,
      operator: "isAnyOf",
      rightOperand: ["gmail", "urn:example:binding"],
      datatype: `${XSD}string`,
    },
    datatype: `${XSD}string`,
  },
  {
    name: "declared string overrides IRI detection",
    constraint: {
      leftOperand: `${AGENT}binding`,
      operator: "eq",
      rightOperand: "urn:example:binding",
      datatype: `${XSD}string`,
    },
    datatype: `${XSD}string`,
  },
  {
    name: "untyped IRI stays an IRI",
    constraint: { leftOperand: "purpose", operator: "eq", rightOperand: "urn:example:purpose" },
  },
  {
    name: "untyped text stays a string",
    constraint: { leftOperand: `${AGENT}binding`, operator: "eq", rightOperand: "gmail" },
    datatype: `${XSD}string`,
  },
  {
    name: "inferred integer",
    constraint: { leftOperand: "count", operator: "lteq", rightOperand: 2 },
    datatype: `${XSD}integer`,
  },
  {
    name: "inferred non-integer",
    constraint: { leftOperand: `${AGENT}spendPerDay`, operator: "lteq", rightOperand: 2.5 },
    datatype: `${XSD}double`,
  },
])("emits backend-readable RDF operand types: $name", async ({ constraint, datatype }) => {
  for (const type of ["permission", "prohibition"] as const) {
    let input = "";
    const p: Policy = {
      id: policy.id,
      [type === "permission" ? "permissions" : "prohibitions"]: [
        { type, action: "read", constraints: [constraint] },
      ],
    };
    const original = structuredClone(p);
    const value = Array.isArray(constraint.rightOperand)
      ? constraint.rightOperand[0]
      : constraint.rightOperand;
    const request = intent({
      action: "read",
      attributes: { [constraint.leftOperand]: value },
      ...(constraint.leftOperand === "dateTime" ? { at: value as string } : {}),
    });
    await sparqPolicyEngine({
      binary: "test",
      run(_binary, args) {
        input = args.input;
        return { stdout: response(), status: 0 };
      },
    }).evaluate(p, request);
    const doc = JSON.parse(input);
    const store = await parseRdf(doc.policy.text, "text/turtle");
    const operands = node(store, "urn:example:sparq-envelope")
      .one("https://www.w3.org/2018/credentials#credentialSubject")
      .one(`${AGENT}policy`)
      .one(`${ODRL}${type}`)
      .one(`${ODRL}constraint`)
      .values(`${ODRL}rightOperand`);
    const expected = Array.isArray(constraint.rightOperand)
      ? constraint.rightOperand
      : [constraint.rightOperand];
    expect(operands.map((v) => v.value)).toEqual(expected.map(String));
    for (const operand of operands) {
      expect(operand.termType).toBe(datatype === undefined ? "NamedNode" : "Literal");
      if (datatype !== undefined)
        expect((operand as unknown as Literal).datatype.value).toBe(datatype);
    }
    expect(
      doc.request.context.find((c: { leftOperand: string }) => c.leftOperand === `${ODRL}dateTime`),
    ).toEqual({ leftOperand: `${ODRL}dateTime`, value: { type: "dateTime", value: request.at } });
    expect(p).toEqual(original);
  }
});

it.each([
  { datatype: "integer", left: "z", right: "1" },
  { datatype: "integer", left: 1.5, right: 1 },
  { datatype: "integer", left: 1, right: "1.5" },
  { datatype: "integer", left: "9007199254740993", right: "1" },
  { datatype: "integer", left: 1, right: Number.MAX_SAFE_INTEGER + 1 },
  { datatype: "decimal", left: "z", right: "1.0" },
  { datatype: "decimal", left: 1, right: "1e2" },
  { datatype: "decimal", left: "1.0000000000000000001", right: "1" },
  { datatype: "decimal", left: "1", right: "1.0000000000000000001" },
  { datatype: "decimal", left: "1.0000000000000000001", right: "1", operator: "neq" },
  { datatype: "decimal", left: "1", right: "1.0000000000000000001", operator: "lt" },
  { datatype: "decimal", left: `0.${"0".repeat(400)}1`, right: "0" },
  { datatype: "decimal", left: ["1", "1.0000000000000000001"], right: ["1"], operator: "isAnyOf" },
  { datatype: "decimal", left: "1", right: ["1", "1.0000000000000000001"], operator: "isNoneOf" },
  { datatype: "double", left: 1, right: "0x10" },
  { datatype: "float", left: "", right: 1 },
  { datatype: "double", left: 1, right: Infinity },
  { datatype: "double", left: 1, right: Number.NaN },
  { datatype: "double", left: 1, right: [1, "z"], operator: "isAnyOf" },
  { datatype: "dateTime", left: "z", right: "2026-10-26T12:00:00Z" },
  { datatype: "dateTime", left: "2026-10-26T12:00:00.0001Z", right: "2026-10-26T12:00:00Z" },
  { datatype: "dateTime", left: "2026-10-26T12:00:00Z", right: "2026-10-26T12:00:00.0001Z" },
  { leftOperand: "dateTime", left: "2026-10-26T12:00:00.0001Z", right: "2026-10-26T12:00:00Z" },
  { datatype: "dateTime", left: "2026-10-26T12:00:00Z", right: "invalid" },
  { datatype: "dateTime", left: "2026-10-26T12:00:00Z", right: "2026-02-30T12:00:00Z" },
  { datatype: "dateTime", left: "2026-10-26", right: "2026-10-26T12:00:00Z" },
  { datatype: "date", left: "2026-10-26", right: "2026-02-30" },
  { datatype: "string", left: 1, right: "x" },
  { datatype: "string", left: "01", right: "1" },
  { datatype: "string", left: "0x10", right: "16" },
  { datatype: "string", left: " 1 ", right: "1" },
  { datatype: "anyURI", left: "relative", right: "urn:valid" },
  { datatype: "anyURI", left: 1, right: "urn:valid" },
  { datatype: "unknown", left: "x", right: "x" },
  { left: 1, right: "invalid", leftOperand: "count" },
  { left: true, right: "x" },
  { left: [], right: "x" },
  { left: undefined, right: "x" },
  { left: "x", right: true },
  { left: "x", right: null },
  { left: "x", right: {} },
  { left: "x", right: ["x", "y"] },
  { left: "x", right: [] },
  { left: "x", right: undefined },
  { left: "x", right: ["x", 1], operator: "isAnyOf" },
  { datatype: "string", left: "2026-10-26T12:00:00Z", right: "z", leftOperand: "dateTime" },
])("validates both SPARQ operands before delegation: %j", async ({
  datatype,
  left,
  right,
  operator,
  leftOperand,
}) => {
  const constraint = {
    leftOperand: leftOperand ?? "purpose",
    operator: operator ?? "eq",
    rightOperand: right,
    ...(datatype === undefined ? {} : { datatype: `${XSD}${datatype}` }),
  } as Constraint;
  const request = intent({
    action: "read",
    attributes: { [constraint.leftOperand]: left } as NonNullable<
      ReturnType<typeof intent>["attributes"]
    >,
    ...(constraint.leftOperand === "dateTime" ? { at: left as string } : {}),
  });
  const run = vi.fn(() => ({ stdout: response(), status: 0 }));
  const adapter = sparqPolicyEngine({ binary: "test", run });
  for (const type of ["permission", "prohibition"] as const) {
    const p: Policy = {
      id: policy.id,
      permissions: policy.permissions,
      [type === "permission" ? "permissions" : "prohibitions"]: [
        { type, action: "read", constraints: [constraint] },
      ],
    };
    expect(await solidOdrlEngine.evaluate(p, request)).toEqual({ effect: "indeterminate" });
    expect(await adapter.evaluate(p, request)).toEqual({ effect: "indeterminate" });
    expect(run).not.toHaveBeenCalled();
    expect(await evaluateIntent({ ...mandate(), autonomous: p }, request, adapter)).toEqual({
      decision: "confirm-required",
      reason: "indeterminate",
    });
    run.mockClear();
  }
});

it("ignores invalid operands only in rules excluded by the shared candidate matcher", async () => {
  const constraints: Constraint[] = [{ leftOperand: "count", operator: "eq", rightOperand: "bad" }];
  const run = vi.fn(() => ({ stdout: response(), status: 0 }));
  expect(
    await sparqPolicyEngine({ binary: "test", run }).evaluate(
      {
        ...policy,
        permissions: [
          ...(policy.permissions ?? []),
          { type: "permission", action: "write", constraints },
        ],
        prohibitions: [
          { type: "prohibition", action: "read", target: "urn:other", constraints },
          { type: "prohibition", action: "read", assignee: "urn:other", constraints },
        ],
      },
      intent({ action: "read" }),
    ),
  ).toEqual({ effect: "permit" });
  expect(run).toHaveBeenCalledOnce();
});

it.each(
  ["isAnyOf", "isNoneOf", "isAllOf"].flatMap((operator) =>
    [
      "",
      "two words",
      "pipe|member",
      "comma,member",
      "tab\tmember",
      "line\nmember",
      "\r",
      "\u0085",
      "\u00a0",
      "\u2003",
    ].map((member) => ({ operator, member })),
  ),
)("rejects non-atomic signed set members: %j", async ({ operator, member }) => {
  for (const rightOperand of [member, [member], ["safe", member], [member, "safe"]]) {
    const constraint = { leftOperand: "purpose", operator, rightOperand } as Constraint;
    const request = intent({
      action: "read",
      attributes: {
        purpose:
          operator === "isNoneOf" ? "outside" : operator === "isAllOf" ? rightOperand : member,
      },
    });
    const run = vi.fn(() => ({ stdout: response(), status: 0 }));
    const adapter = sparqPolicyEngine({ binary: "test", run });
    for (const type of ["permission", "prohibition"] as const) {
      const p: Policy = {
        id: policy.id,
        permissions: policy.permissions,
        [type === "permission" ? "permissions" : "prohibitions"]: [
          { type, action: "read", constraints: [constraint] },
        ],
      };
      expect(await solidOdrlEngine.evaluate(p, request)).toEqual({
        effect: type === "permission" ? "permit" : "prohibited",
      });
      expect(await adapter.evaluate(p, request)).toEqual({ effect: "indeterminate" });
      expect(run).not.toHaveBeenCalled();
      expect(await evaluateIntent({ ...mandate(), autonomous: p }, request, adapter)).toEqual({
        decision: "confirm-required",
        reason: "indeterminate",
      });
      run.mockClear();
    }
  }
});

it.each([
  { right: [1, 2], left: 1 },
  { right: "1", left: "1" },
  { right: ["1", "2"], left: "1", datatype: "integer" },
  { right: ["1.5", "2.5"], left: "1.5", datatype: "decimal" },
  { right: ["1e1", "2e1"], left: "1e1", datatype: "double" },
  { right: [1, 2], left: 1, datatype: "float" },
  {
    right: ["2026-10-26T12:00:00Z", "2026-10-27T12:00:00Z"],
    left: "2026-10-26T12:00:00Z",
    datatype: "dateTime",
  },
  { right: ["2026-10-26", "2026-10-27"], left: "2026-10-26", datatype: "date" },
])("rejects typed set comparisons that SPARQ cannot preserve: %j", async ({
  right,
  left,
  datatype,
}) => {
  for (const operator of ["isAnyOf", "isNoneOf", "isAllOf"] as const) {
    const run = vi.fn(() => ({ stdout: response(), status: 0 }));
    for (const type of ["permission", "prohibition"] as const) {
      expect(
        await sparqPolicyEngine({ binary: "test", run }).evaluate(
          {
            id: policy.id,
            [type === "permission" ? "permissions" : "prohibitions"]: [
              {
                type,
                action: "read",
                constraints: [
                  {
                    leftOperand: "purpose",
                    operator,
                    rightOperand: right,
                    ...(datatype === undefined ? {} : { datatype: `${XSD}${datatype}` }),
                  },
                ],
              },
            ],
          },
          intent({ action: "read", attributes: { purpose: left } }),
        ),
      ).toEqual({ effect: "indeterminate" });
      expect(run).not.toHaveBeenCalled();
    }
  }
});

it.each([
  "isAnyOf",
  "isNoneOf",
  "eq",
] as const)("preserves representable members and scalar text for %s", async (operator) => {
  const rightOperand =
    operator === "eq" ? "two words|comma,tab\t" : ["urn:purpose:a", "plain", "urn:purpose:a%2Cb"];
  const run = vi.fn((_binary: string, _args: ProcessOptions) => ({
    stdout: response({ effect: "deny", matchedRules: ["urn:rule"] }),
    status: 0,
  }));
  expect(
    await sparqPolicyEngine({ binary: "test", run }).evaluate(
      {
        id: policy.id,
        prohibitions: [
          {
            type: "prohibition",
            action: "read",
            constraints: [{ leftOperand: "purpose", operator, rightOperand }],
          },
        ],
      },
      intent({
        action: "read",
        attributes: { purpose: operator === "eq" ? (rightOperand as string) : "urn:purpose:a" },
      }),
    ),
  ).toEqual({ effect: "prohibited" });
  expect(run).toHaveBeenCalledOnce();
  const doc = JSON.parse((run.mock.calls[0] as [string, ProcessOptions])[1].input);
  const store = await parseRdf(doc.policy.text, "text/turtle");
  expect(
    node(store, "urn:example:sparq-envelope")
      .one("https://www.w3.org/2018/credentials#credentialSubject")
      .one(`${AGENT}policy`)
      .one(`${ODRL}prohibition`)
      .one(`${ODRL}constraint`)
      .values(`${ODRL}rightOperand`)
      .map((value) => value.value),
  ).toEqual(Array.isArray(rightOperand) ? rightOperand : [rightOperand]);
});

it.each([
  { operator: "isAllOf", rightOperand: ["plain"], left: ["plain"] },
  { operator: "isAnyOf", rightOperand: ["plain"], left: ["plain"] },
  { operator: "isNoneOf", rightOperand: ["plain"], left: "two words" },
  {
    operator: "isAnyOf",
    rightOperand: ["urn:purpose:a", "urn:purpose:b"],
    left: "urn:purpose:a",
    datatype: "anyURI",
  },
  {
    operator: "isAnyOf",
    rightOperand: ["2026-10-26T12:00:00Z"],
    left: "2026-10-26T12:00:00Z",
    leftOperand: "dateTime",
  },
])("rejects set context or types outside SPARQ's textual representation: %j", async ({
  operator,
  rightOperand,
  left,
  datatype,
  leftOperand,
}) => {
  const constraint = {
    leftOperand: leftOperand ?? "purpose",
    operator,
    rightOperand,
    ...(datatype === undefined ? {} : { datatype: `${XSD}${datatype}` }),
  } as Constraint;
  const request = intent({
    action: "read",
    attributes: { [constraint.leftOperand]: left },
    ...(leftOperand === "dateTime" ? { at: left as string } : {}),
  });
  const run = vi.fn(() => ({ stdout: response(), status: 0 }));
  for (const type of ["permission", "prohibition"] as const) {
    expect(
      await sparqPolicyEngine({ binary: "test", run }).evaluate(
        {
          id: policy.id,
          [type === "permission" ? "permissions" : "prohibitions"]: [
            { type, action: "read", constraints: [constraint] },
          ],
        },
        request,
      ),
    ).toEqual({ effect: "indeterminate" });
    expect(run).not.toHaveBeenCalled();
  }
});

it("fails closed before invoking SPARQ when a declared datatype is not an IRI", async () => {
  let invoked = false;
  const result = await sparqPolicyEngine({
    binary: "test",
    run() {
      invoked = true;
      return { stdout: response(), status: 0 };
    },
  }).evaluate(
    {
      id: policy.id,
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [
            {
              leftOperand: "dateTime",
              operator: "lt",
              rightOperand: "2026-10-27T00:00:00Z",
              datatype: "dateTime",
            },
          ],
        },
      ],
    },
    intent({ action: "read" }),
  );
  expect(result).toEqual({ effect: "indeterminate" });
  expect(invoked).toBe(false);
});

it.each<Constraint>([
  {
    leftOperand: "purpose",
    operator: "eq",
    rightOperand: "1.0000000000000000001",
    datatype: `${XSD}decimal`,
  },
  { leftOperand: "purpose", operator: "isAnyOf", rightOperand: ["two words", "safe"] },
])("retains definite prohibitions alongside an indeterminate comparison: %j", async (constraint) => {
  const request = intent({
    action: "read",
    attributes: { purpose: constraint.datatype ? "1" : "two words" },
  });
  for (const type of ["permission", "prohibition"] as const) {
    const uncertain: Rule = { type, action: "read", constraints: [constraint] };
    const p: Policy = {
      ...policy,
      permissions: [...(policy.permissions ?? []), ...(type === "permission" ? [uncertain] : [])],
      prohibitions: [
        { type: "prohibition", action: "read" },
        ...(type === "prohibition" ? [uncertain] : []),
      ],
    };
    expect(await solidOdrlEngine.evaluate(p, request)).toEqual({ effect: "prohibited" });
    for (const backend of [
      { effect: "deny", matchedRules: ["urn:definite-prohibition"] },
      { effect: "deny", matchedRules: [] },
      { effect: "permit", matchedRules: [] },
    ]) {
      const run = vi.fn((_binary: string, _args: ProcessOptions) => ({
        stdout: response(backend),
        status: 0,
      }));
      const adapter = sparqPolicyEngine({ binary: "test", run });
      const prohibited = backend.matchedRules.length > 0;
      expect(await adapter.evaluate(p, request)).toEqual({
        effect: prohibited ? "prohibited" : "indeterminate",
      });
      expect(run).toHaveBeenCalledOnce();
      const doc = JSON.parse((run.mock.calls[0] as [string, ProcessOptions])[1].input);
      const store = await parseRdf(doc.policy.text, "text/turtle");
      const lowered = node(store, "urn:example:sparq-envelope")
        .one("https://www.w3.org/2018/credentials#credentialSubject")
        .one(`${AGENT}policy`);
      for (const kind of ["permission", "prohibition"]) {
        expect(lowered.values(`${ODRL}${kind}`)).toHaveLength(1);
        expect(lowered.one(`${ODRL}${kind}`).values(`${ODRL}constraint`)).toHaveLength(0);
      }
      expect(await evaluateIntent({ ...mandate(), autonomous: p }, request, adapter)).toEqual(
        prohibited
          ? { decision: "prohibited", reason: "prohibition" }
          : { decision: "confirm-required", reason: "indeterminate" },
      );
    }
  }
});
