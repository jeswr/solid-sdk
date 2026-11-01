// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { ACTION_IRI, LEFT_OPERAND_IRI } from "@jeswr/solid-odrl";
import type { JsonValue } from "@jeswr/solid-vc";
import { credentialToRdf } from "@jeswr/solid-vc";
import { Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { decodeLimit, decodePolicy, encodePolicy } from "../src/codec.js";
import { node, turtle } from "../src/rdf.js";
import { AGENT, ODRL, type Policy } from "../src/types.js";
import { ACTOR, OWNER } from "./helpers.js";

const view = (value: JsonValue) =>
  node(
    new Store(
      credentialToRdf({
        issuer: OWNER,
        credentialSubject: { id: OWNER, [`${AGENT}policy`]: value },
      }),
    ),
    OWNER,
  ).one(`${AGENT}policy`);
it("preserves RDF policy parties, constraints and duty actions", () => {
  const p: Policy = {
    id: "urn:policy",
    type: "Offer",
    assigner: OWNER,
    assignee: ACTOR,
    conflict: "prohibit",
    profile: "urn:profile",
    permissions: [
      {
        id: "urn:rule",
        type: "permission",
        action: "use",
        target: "urn:target",
        assigner: OWNER,
        assignee: ACTOR,
        constraints: [
          {
            leftOperand: "dateTime",
            operator: "gteq",
            rightOperand: "2026-10-26",
            datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
          },
          { leftOperand: "count", operator: "isAnyOf", rightOperand: [1, 2] },
        ],
        duties: [{ action: "inform" }],
      },
    ],
    prohibitions: [{ type: "prohibition", action: "read" }],
    obligations: [{ action: "inform" }],
  };
  const parsed = decodePolicy(view(encodePolicy(p)));
  expect(parsed).toMatchObject(p);
  expect(parsed.obligations).toMatchObject(p.obligations as object);
  expect(parsed.permissions?.[0]?.duties).toMatchObject(p.permissions?.[0]?.duties as object);
});
it.each(
  Object.entries(ACTION_IRI),
)("preserves the shared action identity for %s", (action, iri) => {
  const p: Policy = {
    id: "urn:policy",
    permissions: [{ type: "permission", action, duties: [{ action: action as "append" }] }],
    prohibitions: [{ type: "prohibition", action }],
    obligations: [{ action: action as "append" }],
  };
  const n = view(encodePolicy(p));
  for (const predicate of ["permission", "prohibition", "obligation"])
    expect(n.one(`${ODRL}${predicate}`).iri(`${ODRL}action`)).toBe(iri);
  expect(n.one(`${ODRL}permission`).one(`${ODRL}duty`).iri(`${ODRL}action`)).toBe(iri);
  expect(decodePolicy(n)).toMatchObject(p);
});
it.each(
  Object.entries(LEFT_OPERAND_IRI),
)("preserves the shared operand identity for %s", (leftOperand, iri) => {
  const p: Policy = {
    id: "urn:policy",
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [{ leftOperand, operator: "eq", rightOperand: 1 }],
      },
    ],
  };
  const n = view(encodePolicy(p));
  expect(n.one(`${ODRL}permission`).one(`${ODRL}constraint`).iri(`${ODRL}leftOperand`)).toBe(iri);
  expect(decodePolicy(n)).toMatchObject(p);
});
it.each([
  `${AGENT}Custom`,
  "https://extension.example/vocab#term",
  `${ODRL}extension`,
])("preserves explicit extension identities: %s", (iri) => {
  const p: Policy = {
    id: "urn:policy",
    permissions: [
      {
        type: "permission",
        action: iri,
        constraints: [{ leftOperand: iri, operator: iri as "eq", rightOperand: "value" }],
      },
    ],
  };
  const n = view(encodePolicy(p));
  const r = n.one(`${ODRL}permission`);
  expect(r.iri(`${ODRL}action`)).toBe(iri);
  expect(r.one(`${ODRL}constraint`).iri(`${ODRL}leftOperand`)).toBe(iri);
  expect(r.one(`${ODRL}constraint`).iri(`${ODRL}operator`)).toBe(iri);
  expect(decodePolicy(n)).toMatchObject(p);
});
it.each([
  "eq",
  "neq",
  "gt",
  "gteq",
  "lt",
  "lteq",
] as const)("requires exactly one right operand when encoding and decoding %s", (operator) => {
  const p = (rightOperand: readonly number[]): Policy => ({
    id: "urn:policy",
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [{ leftOperand: "count", operator, rightOperand }],
      },
    ],
  });
  for (const rightOperand of [[], [1, 2], [2, 1]]) {
    expect(() => encodePolicy(p(rightOperand))).toThrow("right operand");
    const raw = encodePolicy(p([1])) as Record<string, JsonValue>;
    const rule = (raw[`${ODRL}permission`] as Record<string, JsonValue>[])[0] as Record<
      string,
      JsonValue
    >;
    const constraint = (rule[`${ODRL}constraint`] as Record<string, JsonValue>[])[0];
    (constraint as Record<string, JsonValue>)[`${ODRL}rightOperand`] = rightOperand;
    expect(() => decodePolicy(view(raw))).toThrow("right operand");
  }
  expect(decodePolicy(view(encodePolicy(p([1])))).permissions?.[0]?.constraints?.[0]).toEqual({
    leftOperand: "count",
    operator,
    rightOperand: 1,
    datatype: undefined,
  });
});
it.each([
  "isAnyOf",
  "isAllOf",
  "isNoneOf",
] as const)("preserves multiple right operands for %s", (operator) => {
  const p: Policy = {
    id: "urn:policy",
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [{ leftOperand: "purpose", operator, rightOperand: ["x", "y"] }],
      },
    ],
  };
  expect(decodePolicy(view(encodePolicy(p)))).toMatchObject(p);
});
it("rejects ambiguous cardinalities and the wrong RDF term kinds", () => {
  const store = new Store();
  const n = node(store, "urn:subject");
  expect(() => n.one("urn:missing")).toThrow("exactly one");
  n.setText("urn:value", "literal");
  expect(() => n.iri("urn:value")).toThrow("IRI");
  n.setIri("urn:key", "urn:object");
  expect(() => n.text("urn:key")).toThrow("literal");
  n.setText("urn:value", "second");
  expect(() => n.text("urn:value")).toThrow("exactly one");
});
it("rejects malformed policy types and right operands", () => {
  const base = encodePolicy({
    id: "urn:policy",
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [{ leftOperand: "count", operator: "eq", rightOperand: 1 }],
      },
    ],
  }) as Record<string, JsonValue>;
  expect(() =>
    decodePolicy(
      view({ ...base, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": "urn:unknown" }),
    ),
  ).toThrow("policy type");
  for (const value of [[], { "urn:nested": "value" }]) {
    const c = {
      [`${ODRL}leftOperand`]: `${ODRL}count`,
      [`${ODRL}operator`]: `${ODRL}eq`,
      [`${ODRL}rightOperand`]: value,
    };
    expect(() =>
      decodePolicy(
        view({
          ...base,
          [`${ODRL}permission`]: { [`${ODRL}action`]: `${ODRL}read`, [`${ODRL}constraint`]: c },
        }),
      ),
    ).toThrow("operand");
  }
});
it("rejects malformed limit values and enforcement flags", () => {
  const base = {
    [`${ODRL}leftOperand`]: `${AGENT}spendPerDay`,
    [`${ODRL}operator`]: `${ODRL}lteq`,
    [`${ODRL}rightOperand`]: 1,
    [`${AGENT}enforcement`]: "hard",
  };
  for (const patch of [
    { [`${ODRL}operator`]: `${ODRL}gt` },
    { [`${ODRL}rightOperand`]: "one" },
    { [`${ODRL}rightOperand`]: -1 },
    { [`${ODRL}rightOperand`]: Number.POSITIVE_INFINITY },
    { [`${AGENT}enforcement`]: "unknown" },
  ])
    expect(() => decodeLimit(view({ ...base, ...patch }))).toThrow("limit");
});
it("propagates serializer errors to callers", async () => {
  const failure = new Error("serialization failed");
  const spy = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback: unknown) => {
    (callback as (e: Error) => void)(failure);
    return undefined as never;
  });
  await expect(turtle(new Store())).rejects.toBe(failure);
  spy.mockRestore();
});
it("represents an empty policy without granting authority", () => {
  expect(decodePolicy(view(encodePolicy({ id: "urn:empty" })))).toMatchObject({
    id: "urn:empty",
    permissions: [],
    prohibitions: [],
  });
});
