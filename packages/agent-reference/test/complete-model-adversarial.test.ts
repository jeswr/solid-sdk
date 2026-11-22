// AUTHORED-BY Codex GPT-6
import { addIriTriple } from "@jeswr/rdf-serialize/wrapper";
import { LiteralFrom, NamedNodeFrom, RequiredAs } from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { type AnyMessage, MESSAGE_KINDS } from "../src/core/types.js";
import { EvidenceItemNode } from "../src/model/evidence-item.js";
import * as model from "../src/model/message-nodes.js";
import { NamedValuesNode } from "../src/model/named-values.js";
import { RdfNode } from "../src/model/nodes.js";
import { testKey } from "../src/reference/keys.js";
import { readDocument, writeDocument } from "../src/wire/document.js";
import { signCompact } from "../src/wire/jws-compact.js";

const operation = { id: "urn:test:op", version: "1" };
const bodies = {
  describe: { want: ["b", "a", "b"] },
  description: { description: { null: null, empty: {}, list: [], iri: "urn:test:claim" } },
  propose: {
    operation,
    terms: { flag: false, number: 1.5 },
    termsDigest: "sha-256:test",
    round: 2,
    counters: "urn:test:prior",
  },
  accept: {
    proposal: "urn:test:proposal",
    termsDigest: "sha-256:test",
    selection: {},
    agreement: "urn:test:agreement",
  },
  challenge: {
    ref: "urn:test:ref",
    reason: "assurance-insufficient",
    detail: "",
    needs: {
      id: "urn:test:needs",
      nonce: "urn:test:nonce",
      expiresAt: "2026-11-14T00:00:00Z",
      claim: "replacement",
    },
  },
  refuse: { ref: "urn:test:ref", reason: "not-authorised", detail: "" },
  invoke: {
    operation,
    input: { values: [null, false, 0, "", "urn:test:value"] },
    basis: { kind: "public" },
    purpose: "urn:test:purpose",
    challenge: { id: "urn:test:challenge", nonce: "urn:test:nonce" },
  },
  deliver: {
    ref: "urn:test:ref",
    basis: { kind: "invocation", invocation: "urn:test:invocation" },
    operation,
    output: { "urn:test:claim": true },
  },
  receipt: {
    ref: "urn:test:ref",
    activity: "urn:test:activity",
    outcome: "uncertain",
    observed: {},
    final: false,
  },
  unsupported: { ref: "urn:test:ref", reason: "unsupported-operation" },
  indeterminate: { ref: "urn:test:ref", reason: "unsupported-term", detail: "" },
};
function message(kind: AnyMessage["kind"]): AnyMessage {
  return {
    profile: "urn:test:profile",
    configuration: "urn:test:configuration",
    id: "urn:test:message",
    conversation: "urn:test:conversation",
    kind,
    from: { actor: "urn:test:actor", onBehalfOf: "urn:test:party", operator: "urn:test:operator" },
    to: { actor: "urn:test:peer", party: "urn:test:peer-party" },
    createdAt: "2026-11-13T00:00:00Z",
    expiresAt: "2026-11-14T00:00:00Z",
    inReplyTo: "urn:test:prior",
    authorship: { method: "model-output", onBehalfOf: "urn:test:party" },
    body: bodies[kind],
    evidence: [],
    content: [],
  } as AnyMessage;
}
async function admit(node: { id: string; dataset: Store }) {
  const result = await readDocument(
    JSON.stringify(await writeDocument(node)),
    "application/ld+json",
  );
  if (!result.ok) throw new Error(result.detail);
  return result;
}
describe("complete message wrappers", () => {
  it.each(
    MESSAGE_KINDS,
  )("round-trips every field of %s, including empty collections and lexical times", async (kind) => {
    const original = message(kind);
    const node = model.MessageNode.toNode(original);
    expect(model.MessageNode.fromNode(node)).toEqual(original);
    const read = await admit(node);
    expect(model.MessageNode.fromNode(new model.MessageNode(read.root, read.dataset))).toEqual(
      original,
    );
  });
  it("covers both approval and claim challenges, all bases and text/byte content", async () => {
    for (const basis of [
      { kind: "public" },
      { kind: "represented" },
      { kind: "agreement", agreement: "urn:test:a" },
      { kind: "grant", grant: "urn:test:g" },
      { kind: "invocation", invocation: "urn:test:i" },
    ] as const) {
      const node = model.BasisNode.toNode(basis);
      await admit(node);
      expect(node.toObject()).toEqual(basis);
    }
    const needs = {
      id: "urn:test:needs",
      nonce: "urn:test:nonce",
      expiresAt: "2026-11-14T00:00:00Z",
      approval: "urn:test:approval",
      label: "Stronger approval",
    };
    expect(model.ChallengeNeedsNode.fromNode(model.ChallengeNeedsNode.toNode(needs))).toEqual(
      needs,
    );
    await admit(model.ChallengeNeedsNode.toNode(needs));
    for (const bytes of [
      "",
      "hello\nworld",
      "https://example.test/text",
      [],
      [0, 255, 0],
    ] as const) {
      const original = {
        id: "urn:test:content",
        mediaType: "application/octet-stream",
        digest: "sha-256:test",
        bytes,
      };
      const node = model.ContentPartNode.toNode(original);
      await admit(node);
      expect(node.toObject()).toEqual(original);
    }
  });
  it("reads live datasets and refuses unknown fields, unsafe IRIs, ambiguous singletons and foreign nodes", () => {
    const node = model.ActionIntentNode.toNode({
      operation: "urn:test:op",
      action: "read",
      target: "urn:test:target",
      parameters: {},
      conversation: "urn:test:c",
    });
    const other = new model.ActionIntentNode(node.id, node.dataset);
    node.target = "urn:test:changed";
    expect(other.target).toBe("urn:test:changed");
    addIriTriple(node, "http://www.w3.org/ns/odrl/2/target", "urn:test:ambiguous");
    expect(() => other.target).toThrow("Ambiguous");
    expect(() =>
      model.MessageNode.toNode({ ...message("describe"), extra: true } as never),
    ).toThrow("Unknown");
    for (const field of ["constructor", "toString", "__proto__"]) {
      const poisoned = Object.fromEntries([...Object.entries(message("describe")), [field, true]]);
      expect(() => model.MessageNode.toNode(poisoned as never)).toThrow("Unknown");
      expect(() => node.getField(field)).toThrow("Unknown");
      expect(() => node.setField(field, true)).toThrow("Unknown");
    }
    expect(() => {
      node.target = "urn:test:>unsafe";
    }).toThrow();
    expect(() => {
      node.parameters = NamedValuesNode.from({}, "urn:test:foreign");
    }).toThrow("same dataset");
    expect(() => {
      node.action = undefined as never;
    }).toThrow("Missing");
    expect(() => {
      node.setField("invented", "value");
    }).toThrow("Unknown");
  });
  it("retains exact finite numbers, prototype-like keys and IRIs without serializing JSON literals", async () => {
    const input = Object.fromEntries([
      ["__proto__", { safe: true }],
      [
        "urn:example:claim",
        [Number.MIN_VALUE, Number.MAX_VALUE, 1.0000000000000002, -0, null, false, ""],
      ],
    ]);
    const node = NamedValuesNode.from(input, "urn:test:values");
    expect(node.toObject()).toEqual(input);
    const read = await admit(node);
    expect(new NamedValuesNode(read.root, read.dataset).toObject()).toEqual(input);
    expect(
      [...node.dataset].some(
        (q) => q.object.termType === "Literal" && q.object.datatype.value.endsWith("#JSON"),
      ),
    ).toBe(false);
    expect(() => NamedValuesNode.from({ bad: Infinity }, "urn:test:bad")).toThrow();
  });
  it("refuses a parameter alias mismatch, duplicate positions and cycles", () => {
    const node = NamedValuesNode.from({ a: 1, b: 2 }, "urn:test:values");
    const entry = node.entries[0]!;
    RequiredAs.object(
      entry,
      "https://schema.org/propertyID",
      "urn:test:wrong",
      NamedNodeFrom.string,
    );
    expect(() => node.toObject()).toThrow("mismatch");
    const cyclic = NamedValuesNode.from({ a: 1 }, "urn:test:cycle");
    cyclic.entries[0]!.domainValue = DataFactory.namedNode(cyclic.id);
    expect(() => cyclic.toObject()).toThrow("Cyclic");
    const duplicate = NamedValuesNode.from([1, 2], "urn:test:duplicate");
    const second = duplicate.entries[1]!;
    RequiredAs.object(second, "https://schema.org/position", 0, LiteralFrom.integer);
    expect(() => duplicate.toValue()).toThrow("position");
  });
});

it("embeds a real byte-exact signed credential; refuses tampering, unknown keys and substituted prior evidence", async () => {
  const key = await testKey("brief22c/evidence");
  const payload = {
    id: "urn:test:statement",
    issuer: "urn:test:issuer",
    subject: "urn:test:subject",
    claimType: "urn:test:claim",
    value: { amount: 123 },
    validUntil: "2026-11-14T00:00:00Z",
  };
  const jws = await signCompact(key, "awp-statement+jws", payload);
  const item = { role: "credential" as const, format: "jws-compact", value: jws };
  const node = EvidenceItemNode.toNode(item);
  expect(node.toObject()).toEqual(item);
  await admit(node);
  const verify = {
    typ: "awp-statement+jws",
    resolve: (kid: string) => (kid === key.kid ? key : undefined),
  };
  expect(await node.credential!.verifyOriginal(verify)).toBe(true);
  expect(await node.credential!.verifyOriginal({ ...verify, resolve: () => undefined })).toBe(
    false,
  );
  expect(await node.credential!.verifyOriginal({ ...verify, typ: "wrong+jws" })).toBe(false);
  const payloadNode = node.dataset.getSubjects(
    DataFactory.namedNode("https://schema.org/name"),
    DataFactory.literal("claimType"),
    null,
  )[0]!;
  RequiredAs.object(
    new RdfNode(payloadNode, node.dataset),
    "https://schema.org/value",
    "urn:test:changed",
    NamedNodeFrom.string,
  );
  expect(await node.credential!.verifyOriginal(verify)).toBe(false);
  const digest = digestBytes(jws);
  const ref = EvidenceItemNode.byDigest(
    { role: "credential", format: "jws-compact", digest },
    "urn:test:reference",
  );
  await admit(ref);
  expect(ref.resolvePrior(() => jws)).toBe(jws);
  expect(() => ref.resolvePrior(() => undefined)).toThrow("missing");
  expect(() => ref.resolvePrior(() => jws + "x")).toThrow("mismatch");
  expect(() =>
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: "sha-256:bad" },
      "urn:test:bad",
    ),
  ).toThrow("digest");
  expect(() => EvidenceItemNode.toNode({ ...item, value: "a.b.c" })).toThrow();
});

it("refuses conflicting bases, incomplete challenges and invalid byte ranges", async () => {
  const invalid = [
    model.BasisNode.toNode({ kind: "public", agreement: "urn:test:a" } as never),
    model.BasisNode.toNode({ kind: "grant" } as never),
    model.ChallengeNeedsNode.toNode({
      id: "urn:test:n",
      nonce: "urn:test:nonce",
      expiresAt: "2026-11-14T00:00:00Z",
      approval: "urn:test:approval",
    } as never),
    model.ChallengeNeedsNode.toNode({
      id: "urn:test:n",
      nonce: "urn:test:nonce",
      expiresAt: "2026-11-14T00:00:00Z",
      approval: "urn:test:approval",
      label: "Approval",
      claim: "also-a-claim",
    } as never),
    ...[-1, 256, 1.5].map((value) =>
      model.ContentPartNode.toNode({
        id: "urn:test:bytes",
        mediaType: "application/octet-stream",
        digest: "sha-256:test",
        bytes: [value],
      }),
    ),
  ];
  for (const node of invalid) {
    const read = await readDocument(
      JSON.stringify(await writeDocument(node)),
      "application/ld+json",
    );
    expect(read).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: expect.stringContaining("Shape;path="),
    });
  }
});
