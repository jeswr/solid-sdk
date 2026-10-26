// AUTHORED-BY Codex GPT-6.1-Sol

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
          { leftOperand: "count", operator: "lteq", rightOperand: [1, 2] },
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
