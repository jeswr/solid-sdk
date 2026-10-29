// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal } from "@rdfjs/types";
import { expect, it } from "vitest";
import { node } from "../src/rdf.js";
import {
  type ProcessOptions,
  type ProcessResult,
  SPARQ_DECIDE_API,
  sparqPolicyEngine,
} from "../src/sparq.js";
import type { Constraint, Policy, Rule } from "../src/types.js";
import { AGENT, ODRL } from "../src/types.js";
import { ACTOR, intent } from "./helpers.js";

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
    name: "every member of an inferred temporal set",
    constraint: {
      leftOperand: "dateTime",
      operator: "isAnyOf",
      rightOperand: ["2026-10-26T12:00:00Z", "2026-10-27T00:00:00Z"],
    },
    datatype: `${XSD}dateTime`,
  },
  ...["integer", "decimal", "double", "float"].map((datatype) => ({
    name: `declared ${datatype} with lexical operands`,
    constraint: {
      leftOperand: "count",
      operator: "isAnyOf" as const,
      rightOperand: ["+0002", "10"],
      datatype: `${XSD}${datatype}`,
    },
    datatype: `${XSD}${datatype}`,
  })),
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
    await sparqPolicyEngine({
      binary: "test",
      run(_binary, args) {
        input = args.input;
        return { stdout: response(), status: 0 };
      },
    }).evaluate(p, intent({ action: "read" }));
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
    ).toEqual({ leftOperand: `${ODRL}dateTime`, value: { type: "dateTime", value: intent().at } });
    expect(p).toEqual(original);
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
