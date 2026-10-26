// AUTHORED-BY Codex GPT-6
import { BlankNode, DataFactory as df } from "n3";
import { expect, it } from "vitest";
import {
  buildNanopublications,
  canonicalizeAssertion,
  parseNanopublications,
  serializeNanopublications,
  UnsupportedBlankNodeLabelError,
} from "../src/index.js";
import { NS, ReferenceStore as Store } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const subject = df.namedNode("https://example.org/audit");
const predicate = df.namedNode(`${NS.schema}relatedTo`);
const object = df.namedNode("https://example.org/object");

const batch = () => ({
  batch_id: "blank-node-safety",
  worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic" },
  claims: [],
});

it.each([
  "",
  ".leading",
  "trailing.",
  "two words",
  "newline\nlabel",
  "trailing\n",
  "tab\tlabel",
  "carriage\rlabel",
  "colon:label",
  "-leading",
  "\u0301leading",
  "\uD800",
  "\u{F0000}",
  'label . <https://example.org/evil> <https://schema.org/name> "injected" #',
])("rejects blank-node label %j before hashing, building or serialization", async (label) => {
  const blank = new BlankNode(label);
  for (const position of ["subject", "object", "graph"] as const) {
    const quad = df.quad(
      position === "subject" ? blank : subject,
      predicate,
      position === "object" ? blank : object,
      position === "graph" ? blank : df.defaultGraph(),
    );
    const assertion = new Store([quad]);
    if (position !== "graph") {
      expect(() => canonicalizeAssertion(assertion)).toThrow(UnsupportedBlankNodeLabelError);
      await expect(
        buildNanopublications(
          { ...batch(), claims: [{ id: "one", assertion, epistemic: "Mentioned" }] },
          options,
        ),
      ).rejects.toThrow(UnsupportedBlankNodeLabelError);
    }
    const built = await buildNanopublications(batch(), options);
    built.dataset.addQuad(quad);
    await expect(serializeNanopublications(built)).rejects.toThrow(UnsupportedBlankNodeLabelError);
  }
});

it.each([
  "node",
  "0",
  "_node",
  "a-b",
  "a.b",
  "étiquette",
  "节点",
  "a·b",
  "a\u0301",
  "𐀀",
])("preserves shared references for valid blank-node label %j through TriG", async (label) => {
  const built = await buildNanopublications(
    {
      ...batch(),
      claims: [
        {
          id: "one",
          assertion: '<https://example.org/a> schema:name "A" .',
          epistemic: "Mentioned",
        },
      ],
    },
    options,
  );
  const blank = df.blankNode(label);
  const namedGraph = df.namedNode("https://example.org/audit-graph");
  built.dataset.addQuad(subject, predicate, blank, namedGraph);
  built.dataset.addQuad(blank, predicate, object, namedGraph);
  built.dataset.addQuad(subject, predicate, object, blank);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  const reference = parsed.dataset.getQuads(subject, predicate, null, namedGraph)[0]?.object;
  expect(reference?.termType).toBe("BlankNode");
  if (!reference) throw new Error("Missing shared blank node");
  expect(parsed.dataset.getQuads(reference, predicate, object, namedGraph)).toHaveLength(1);
  expect(parsed.dataset.getQuads(subject, predicate, object, reference)).toHaveLength(1);
  expect(parsed.dataset.size).toBe(built.dataset.size);
});
