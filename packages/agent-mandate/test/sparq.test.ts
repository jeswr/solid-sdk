// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { expect, it } from "vitest";
import { node } from "../src/rdf.js";
import {
  type ProcessOptions,
  type ProcessResult,
  SPARQ_DECIDE_API,
  sparqPolicyEngine,
} from "../src/sparq.js";
import type { Policy } from "../src/types.js";
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
  expect(doc.request.action).toBe("http://www.w3.org/ns/odrl/2/read");
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
  ["append", "http://www.w3.org/ns/auth/acl#Append"],
  ["control", "http://www.w3.org/ns/auth/acl#Control"],
  [`${AGENT}SendMessage`, `${AGENT}SendMessage`],
])("sends shared vocabulary identities to the external engine: %s", async (action, iri) => {
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
  expect(doc.request.action).toBe(iri);
  expect(doc.request.context[0].leftOperand).toBe(
    "https://w3id.org/jeswr/odrl-delegation#delegationDepth",
  );
  expect(doc.request.context[1].leftOperand).toBe(`${AGENT}binding`);
  const store = await parseRdf(doc.policy.text, "text/turtle");
  const rule = node(store, "urn:example:sparq-envelope")
    .one("https://www.w3.org/2018/credentials#credentialSubject")
    .one(`${AGENT}policy`)
    .one(`${ODRL}permission`);
  expect(rule.iri(`${ODRL}action`)).toBe(iri);
  expect(rule.one(`${ODRL}constraint`).iri(`${ODRL}leftOperand`)).toBe(
    "https://w3id.org/jeswr/odrl-delegation#delegationDepth",
  );
});
