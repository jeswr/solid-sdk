// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { once } from "events";
import { DataFactory, Store, termToId } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { Readable } from "stream";
import { expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { containsObject, IndexedStore, objectsAt, subjectsAt } from "../src/model/indexed-store.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { AWP } from "../src/profile/vocabulary.js";
import { readAttachmentDocument, writeAttachmentDocument } from "../src/wire/attachments.js";
import {
  documentDataset,
  readDocument,
  validateRoot,
  writeDocument,
} from "../src/wire/document.js";

function message() {
  return MessageNode.toNode({
    profile: "urn:test:profile",
    configuration: "urn:test:configuration",
    id: "urn:test:performance-message",
    conversation: "urn:test:conversation",
    kind: "invoke",
    from: { actor: "urn:test:sender" },
    to: { actor: "urn:test:receiver" },
    createdAt: "2026-11-13T09:00:00.000Z",
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {
      operation: { id: "urn:test:operation", version: "1" },
      input: { count: 1 },
      basis: { kind: "public" },
    },
  });
}

it("reuses shapes without sharing error reports, node-check counters or concurrent data", async () => {
  const node = message();
  const bad = new Store([...node.dataset]);
  bad.removeQuads(
    bad.getQuads(
      DataFactory.namedNode(node.id),
      DataFactory.namedNode(AWP + "createdAt"),
      null,
      null,
    ),
  );
  // More than the validator's 50 node checks: stale counters must never skip a later refusal.
  for (let i = 0; i < 60; i++) await validateRoot(node.dataset, node.id);
  for (let i = 0; i < 4; i++) {
    const results = await Promise.allSettled([
      validateRoot(bad, node.id),
      validateRoot(node.dataset, node.id),
      validateRoot(bad, node.id),
      validateRoot(node.dataset, node.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason.message).toBe(`shape=${AWP}MessageShape;path=${AWP}createdAt`);
  }
});

it("indexes current quads across graphs with native ordering and invalidates every write route", async () => {
  const { namedNode: nn, literal, blankNode, defaultGraph, quad } = DataFactory;
  const subjects = [nn("urn:test:a"), nn("urn:test:b"), blankNode("subject")];
  const predicates = [nn("urn:test:p"), nn("urn:test:q")];
  const objects = [literal("value"), nn("urn:test:object"), literal("name", "en")];
  const graphs = [defaultGraph(), nn("urn:test:g1"), nn("urn:test:g2")];
  const quads = graphs.flatMap((g) =>
    subjects.flatMap((s) => predicates.flatMap((p) => objects.map((o) => quad(s, p, o, g)))),
  );
  const native = new Store(quads),
    indexed = new IndexedStore(quads);
  const ids = (terms: readonly import("@jeswr/fetch-rdf").Term[]) =>
    terms.map((term) => termToId(term as never));
  const check = () => {
    for (const s of [...subjects, nn("urn:test:missing")])
      for (const p of predicates) {
        expect(ids(objectsAt(indexed, s, p.value))).toEqual(
          ids(native.getQuads(s, p, null, null).map((q) => q.object)),
        );
        for (const o of objects)
          expect(containsObject(indexed, s, p.value, o)).toBe(native.countQuads(s, p, o, null) > 0);
      }
    for (const p of predicates)
      for (const o of objects)
        expect(ids(subjectsAt(indexed, p.value, o))).toEqual(ids(native.getSubjects(p, o, null)));
    expect([...indexed]).toEqual([...native]);
  };
  check();
  // Includes equal-size replacement: quad count is never a cache-validity test.
  const a = quads[0]!,
    b = quad(subjects[0]!, predicates[0]!, literal("replacement"), graphs[1]);
  for (const store of [native, indexed]) {
    store.removeQuad(a);
    store.addQuad(b);
  }
  check();
  for (const store of [native, indexed]) store.delete(b);
  check();
  for (const store of [native, indexed]) store.add(a);
  check();
  for (const store of [native, indexed])
    store.removeQuad(a.subject, a.predicate, a.object, a.graph);
  check();
  for (const store of [native, indexed]) store.addQuad(a.subject, a.predicate, a.object, a.graph);
  check();
  for (const store of [native, indexed]) store.removeQuads(quads.slice(1, 4));
  check();
  for (const store of [native, indexed]) store.addQuads(quads.slice(1, 4));
  check();
  for (const store of [native, indexed]) store.deleteMatches(subjects[0], predicates[0]);
  check();
  for (const store of [native, indexed]) store.addAll(quads);
  check();
  // Read terms cannot mutate the lexical IDs retained by the read index.
  const returned = objectsAt(indexed, subjects[0]!, predicates[0]!.value)[0]!;
  Object.assign(returned, { id: '"changed' });
  check();
  for (const store of [native, indexed])
    await once(store.remove(Readable.from(quads.slice(0, 2))), "end");
  check();
  for (const store of [native, indexed])
    await once(store.import(Readable.from(quads.slice(0, 2))), "end");
  check();
  for (const store of [native, indexed])
    await once(store.removeMatches(subjects[0], predicates[0]), "end");
  check();
  for (const store of [native, indexed]) store.addQuads(quads);
  check();
  for (const store of [native, indexed]) await once(store.deleteGraph(graphs[1]!), "end");
  check();
});

it("keeps indexed attachment values live after admission and same-size replacement", async () => {
  const node = message();
  const body = node.getField("body") as import("../src/model/message-nodes.js").InvokeBodyNode;
  body.input = { count: 1, large: "x".repeat(9000) };
  const packet = await writeAttachmentDocument(node);
  expect(packet.attachments.length).toBeGreaterThan(0);
  const read = await readAttachmentDocument(JSON.stringify(packet.document), packet.attachments);
  if (!read.ok) throw new Error(read.detail);
  const wrapper = new MessageNode(read.root, read.dataset);
  const input = (wrapper.getField("body") as typeof body).input;
  const live = input.live;
  for (let i = 0; i < 20; i++) expect((live as { count: number }).count).toBe(1);
  const entry = input.entries.find((entry) => entry.name === "count")!;
  const size = entry.dataset.size;
  entry.domainValue = DataFactory.literal(
    "2",
    DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  expect(entry.dataset.size).toBe(size);
  expect((live as { count: number }).count).toBe(2);
});

it("isolates byte-derived datasets and applies tighter bounds after a warm conversion", async () => {
  const node = message();
  const document = await writeDocument(node);
  const bytes = JSON.stringify(document);
  const first = await documentDataset(document);
  first.removeQuads([...first]);
  const next = await documentDataset(document);
  expect(next.size).toBe(node.dataset.size);
  const admitted = await readDocument(bytes, "application/ld+json");
  expect(admitted.ok).toBe(true);
  if (admitted.ok) admitted.dataset.removeQuads([...admitted.dataset]);
  const again = await readDocument(bytes, "application/ld+json");
  expect(again.ok && again.dataset.size).toBe(node.dataset.size);
  expect(
    await readDocument(bytes, "application/ld+json", {
      limits: { ...DEFAULT_LIMITS, maxEnvelopeBytes: bytes.length - 1 },
    }),
  ).toMatchObject({ ok: false, reason: "bounds-exceeded" });
  await expect(documentDataset(document, { ...DEFAULT_LIMITS, maxJsonNodes: 1 })).rejects.toThrow();
  const changed = { ...document, conversation: "urn:test:changed" };
  const converted = await documentDataset(changed);
  expect(new MessageNode(node.id, converted).conversation).toBe("urn:test:changed");
});
