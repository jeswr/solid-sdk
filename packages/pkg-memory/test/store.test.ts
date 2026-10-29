// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee these entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { policyToTurtle } from "@jeswr/solid-odrl";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it, vi } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  type Fact,
  NanopubStore,
  type PodPort,
  parseNanopublications,
  pkgId,
  purposeFilter,
  serializeNanopublications,
} from "../src/index.js";
import { podStatus } from "../src/pod-port.js";
import { graph, NS, putGraph, RdfNode } from "../src/rdf.js";
import { createMemoryPodPort, exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const identity = { root: "https://example.org/pod/", webId: options.owner };
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const statusError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const build = (
  batch = "store",
  fact: Fact = { template: "email", value: "avery@example.org" },
  generatedAt = options.generatedAt,
) =>
  buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          epistemic: "SelfReportedExplicit",
          categories: ["pd:EmailAddress"],
          assertion: createFactAssertion(identity.webId, fact),
        },
      ],
    },
    { ...options, generatedAt },
  );
function setup(overrides: Partial<PodPort> = {}) {
  const memory = createMemoryPodPort(identity);
  const pod = { ...memory, ...overrides };
  const write = vi.spyOn(pod, "write");
  return { memory, pod, write, store: new NanopubStore(pod) };
}

async function sharedBlankAssertions(ids = ["one", "two"], batch = "shared-blank") {
  const value = await buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: ids.map((id) => ({
        id,
        epistemic: "SelfReportedExplicit",
        assertion: createFactAssertion(identity.webId, {
          template: "email",
          value: "avery@example.org",
        }),
      })),
    },
    options,
  );
  const assertionId = value.nanopubs[0]!.assertionId;
  for (const quad of [...value.dataset])
    if (quad.graph.value === assertionId) value.dataset.delete(quad);
  const assertion = new Store();
  const preference = DataFactory.blankNode("preference");
  const nested = DataFactory.blankNode("nested");
  new RdfNode(identity.webId, assertion).add(`${NS.schema}hasPreference`, preference);
  new RdfNode(preference, assertion)
    .text(`${NS.schema}value`, "tea")
    .add(`${NS.schema}additionalProperty`, nested);
  new RdfNode(nested, assertion).text(`${NS.schema}value`, "hot");
  putGraph(value.dataset as Store, assertionId, assertion);
  return parseNanopublications(await serializeNanopublications(value));
}

async function sharedBlankBatchGraphs(batch = "shared-batch", ids = ["one", "two", "three"]) {
  const source = "https://example.org/document";
  const value = await buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      sources: [{ id: "document", kind: "document", url: source }],
      claims: ids.map((id) => ({
        id,
        epistemic: "SelfReportedExplicit",
        assertion: createFactAssertion(identity.webId, {
          template: "email",
          value: `${id}@example.org`,
        }),
      })),
    },
    options,
  );
  const author = DataFactory.blankNode();
  const nested = DataFactory.blankNode();
  const sources = graph(value.dataset, pkgId("batch", batch, "sources"));
  new RdfNode(source, sources).add(`${NS.schema}author`, author);
  new RdfNode(author, sources)
    .text(`${NS.schema}name`, "Avery")
    .add(`${NS.schema}additionalProperty`, nested);
  new RdfNode(nested, sources).text(`${NS.schema}value`, "source detail");
  putGraph(value.dataset as Store, pkgId("batch", batch, "sources"), sources);
  const entities = new Store();
  new RdfNode(source, entities).add(`${NS.schema}author`, author);
  new RdfNode(author, entities).text(`${NS.schema}description`, "Document author");
  const entity = DataFactory.blankNode();
  new RdfNode(source, entities).add(`${NS.schema}about`, entity);
  new RdfNode(entity, entities)
    .text(`${NS.schema}name`, "Example entity")
    .add(`${NS.prov}wasAttributedTo`, author);
  putGraph(value.dataset as Store, pkgId("batch", batch, "entities"), entities);
  for (const np of value.nanopubs) {
    const provenance = graph(value.dataset, np.provenanceId);
    const local = DataFactory.blankNode();
    new RdfNode(np.id, provenance)
      .add(`${NS.prov}primarySource`, author)
      .add(`${NS.prov}qualifiedAssociation`, local);
    new RdfNode(local, provenance)
      .text(`${NS.schema}name`, np.identifier)
      .add(`${NS.prov}entity`, entity);
    new RdfNode(author, provenance).link(`${NS.prov}wasDerivedFrom`, np.id);
    new RdfNode(nested, provenance).text(`${NS.schema}description`, np.identifier);
    putGraph(value.dataset as Store, np.provenanceId, provenance);
    const pubinfo = graph(value.dataset, np.pubinfoId);
    new RdfNode(np.id, pubinfo).add(`${NS.prov}primarySource`, entity);
    putGraph(value.dataset as Store, np.pubinfoId, pubinfo);
  }
  return value;
}

async function symmetricSharedAuthors(ids = ["one", "two"]) {
  const value = await sharedBlankBatchGraphs("symmetric-authors", ids);
  const source = "https://example.org/document";
  const sourcesId = pkgId("batch", "symmetric-authors", "sources");
  const entitiesId = pkgId("batch", "symmetric-authors", "entities");
  const sources = graph(value.dataset, sourcesId);
  const author = new RdfNode(source, sources).one(`${NS.schema}author`);
  const other = DataFactory.blankNode();
  new RdfNode(source, sources).add(`${NS.schema}author`, other);
  for (const name of [sourcesId, entitiesId]) {
    const contents = name === sourcesId ? sources : graph(value.dataset, name);
    for (const quad of [...contents])
      if (quad.subject.equals(author) || quad.object.equals(author))
        new RdfNode(quad.subject.equals(author) ? other : quad.subject, contents).add(
          quad.predicate.value,
          quad.object.equals(author) ? other : quad.object,
        );
    putGraph(value.dataset as Store, name, contents);
  }
  return { value, author, other, sourcesId };
}

async function symmetricAssertionBatch(batch: string, ids = ["one"]) {
  const value = await sharedBlankAssertions(ids, batch);
  const assertionId = value.nanopubs[0]!.assertionId;
  const assertion = new Store();
  const sourcesId = pkgId("batch", batch, "sources");
  const sources = graph(value.dataset, sourcesId);
  const nodes = [DataFactory.blankNode(), DataFactory.blankNode()];
  for (const [index, node] of nodes.entries()) {
    new RdfNode(identity.webId, assertion).add(`${NS.schema}hasPreference`, node);
    new RdfNode(node, assertion).text(`${NS.schema}value`, "tea");
    new RdfNode("https://example.org/document", sources).add(`${NS.schema}about`, node);
    new RdfNode(node, sources).text(`${NS.schema}name`, `Preference ${index}`);
  }
  putGraph(value.dataset as Store, assertionId, assertion);
  putGraph(value.dataset as Store, sourcesId, sources);
  for (const np of value.nanopubs) {
    const provenance = graph(value.dataset, np.provenanceId);
    new RdfNode(np.id, provenance).add(`${NS.prov}primarySource`, nodes[0]!);
    putGraph(value.dataset as Store, np.provenanceId, provenance);
  }
  return value;
}

async function jointCorrespondence(mergeNodes = true) {
  const first = await sharedBlankAssertions(["one"], "joint-first");
  const second = await build("joint-second", { template: "email", value: "other@example.org" });
  const third = await sharedBlankAssertions(["three"], "joint-second");
  for (const value of [second, third]) {
    const np = value.nanopubs[0]!;
    const node =
      value === third && mergeNodes
        ? new RdfNode(identity.webId, graph(value.dataset, np.assertionId)).one(
            `${NS.schema}hasPreference`,
          )
        : DataFactory.blankNode();
    const name = pkgId("batch", np.batch, "sources");
    const sources = graph(value.dataset, name);
    new RdfNode("https://example.org/document", sources).add(`${NS.schema}about`, node);
    new RdfNode(node, sources).text(`${NS.schema}name`, "Preference");
    putGraph(value.dataset as Store, name, sources);
  }
  return [first, second, third];
}

it.each([
  [0, 1, 2],
  [1, 0, 2],
  [0, 2, 1],
  [2, 0, 1],
  [1, 2, 0],
  [2, 1, 0],
])("rejects inconsistent joint correspondence across three puts in order %s, %s, %s", async (...order) => {
  const { store, pod, write } = setup();
  const values = await jointCorrespondence();
  const [first, second, third] = order.map((index) => values[index]!);
  await store.put(first!);
  await store.put(second!);
  const urls = [first!, second!].map((value) => store.url(value.nanopubs[0]!.id));
  const before = await Promise.all(urls.map((url) => pod.read(url)));
  const unrelated = await build("unrelated", { template: "email", value: "unrelated@example.org" });
  const incoming = {
    dataset: new Store([...unrelated.dataset, ...third!.dataset]),
    nanopubs: [...unrelated.nanopubs, ...third!.nanopubs],
  };
  const list = pod.list;
  for (const reverse of [false, true]) {
    pod.list = async (container) => {
      const entries = await list(container);
      return reverse ? entries.reverse() : entries;
    };
    write.mockClear();
    await expect(new NanopubStore(pod).put(incoming)).rejects.toThrow(
      /Conflicting blank-node references|Unsupported cross-resource blank-node sharing/,
    );
    expect(write).not.toHaveBeenCalled();
    expect(await Promise.all(urls.map((url) => pod.read(url)))).toEqual(before);
    for (const np of incoming.nanopubs)
      await expect(store.get(np.id)).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 2; i++) expect((await store.list()).nanopubs).toHaveLength(2);
  }
});

it("preserves independent nodes when repeating graphs from two stored resources", async () => {
  const { store, pod } = setup();
  const values = await jointCorrespondence(false);
  for (const value of values) await new NanopubStore(pod).put(value);
  const list = pod.list;
  for (const reverse of [false, true]) {
    pod.list = async (container) => {
      const entries = await list(container);
      return reverse ? entries.reverse() : entries;
    };
    const loaded = await store.list();
    expect(loaded.nanopubs).toHaveLength(3);
    const np = values[2]!.nanopubs[0]!;
    const preference = new RdfNode(identity.webId, graph(loaded.dataset, np.assertionId)).one(
      `${NS.schema}hasPreference`,
    );
    const about = new RdfNode(
      "https://example.org/document",
      graph(loaded.dataset, pkgId("batch", np.batch, "sources")),
    ).one(`${NS.schema}about`);
    expect(preference.equals(about)).toBe(false);
  }
});

it.each([
  false,
  true,
])("rejects ambiguous assertion correspondence across separate puts (reverse put order: %s)", async (reverse) => {
  const { store, pod, write } = setup();
  const values = [await symmetricAssertionBatch("first"), await symmetricAssertionBatch("second")];
  if (reverse) values.reverse();
  const [first, second] = values;
  await store.put(first!);
  const url = store.url(first!.nanopubs[0]!.id);
  const before = await pod.read(url);
  const unrelated = await build("unrelated");
  const incoming = {
    dataset: new Store([...unrelated.dataset, ...second!.dataset]),
    nanopubs: [...unrelated.nanopubs, ...second!.nanopubs],
  };
  write.mockClear();
  // A new instance must validate persisted copies, without relying on an in-memory map.
  await expect(new NanopubStore(pod).put(incoming)).rejects.toThrow(
    "Ambiguous shared blank-node identity",
  );
  expect(write).not.toHaveBeenCalled();
  expect(await pod.read(url)).toEqual(before);
  for (const np of incoming.nanopubs)
    await expect(store.get(np.id)).rejects.toMatchObject({ status: 404 });
  const list = pod.list;
  for (const reversed of [false, true]) {
    if (reversed) pod.list = async (container) => (await list(container)).reverse();
    for (let i = 0; i < 2; i++) {
      const loaded = await store.list();
      expect(loaded.nanopubs).toHaveLength(1);
      expect(isomorphic([...loaded.dataset], [...first!.dataset])).toBe(true);
    }
  }
});

it.each([
  false,
  true,
])("preserves jointly distinguished assertion nodes across separate puts (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const value = await symmetricAssertionBatch("same-batch", ["one", "two"]);
  for (const np of value.nanopubs) {
    const dataset = new Store();
    for (const name of [
      np.id,
      np.assertionId,
      np.provenanceId,
      np.pubinfoId,
      pkgId("batch", np.batch, "sources"),
      pkgId("batch", np.batch, "entities"),
    ])
      putGraph(dataset, name, graph(value.dataset, name));
    await new NanopubStore(pod).put({ dataset, nanopubs: [np] });
  }
  const list = pod.list;
  if (reverse) pod.list = async (container) => (await list(container)).reverse();
  for (let i = 0; i < 2; i++)
    expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it("rejects conflicting shared graph copies in a later put before any write", async () => {
  const { store, write } = setup();
  const first = await sharedBlankAssertions(["one"], "first");
  const second = await sharedBlankAssertions(["two"], "second");
  const assertionId = second.nanopubs[0]!.assertionId;
  const assertion = graph(second.dataset, assertionId);
  new RdfNode(identity.webId, assertion).text(`${NS.schema}description`, "Different contents");
  putGraph(second.dataset as Store, assertionId, assertion);
  await store.put(first);
  write.mockClear();
  await expect(store.put(second)).rejects.toThrow("Conflicting copies");
  expect(write).not.toHaveBeenCalled();
  expect(isomorphic([...(await store.list()).dataset], [...first.dataset])).toBe(true);
});

it("allows the first put when the collection listing returns 404", async () => {
  const { store, pod, memory } = setup();
  pod.list = async (container) => {
    await memory.read(container);
    return memory.list(container);
  };
  const value = await build();
  await expect(store.put(value)).resolves.toHaveLength(1);
  expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it("fails before any write when the existing collection cannot be listed", async () => {
  const { store, pod, write } = setup();
  pod.list = async () => {
    throw statusError(403);
  };
  await expect(store.put(await build())).rejects.toMatchObject({ status: 403 });
  expect(write).not.toHaveBeenCalled();
});

it("fails before any write when a listed resource disappears during validation", async () => {
  const { store, pod, memory, write } = setup();
  const value = await build();
  await store.put(value);
  const url = store.url(value.nanopubs[0]!.id);
  pod.read = async (target) => {
    if (target === url) throw statusError(404);
    return memory.read(target);
  };
  write.mockClear();
  await expect(store.put(await build("later"))).rejects.toMatchObject({ status: 404 });
  expect(write).not.toHaveBeenCalled();
});

it.each([
  "provenance",
  "pubinfo",
])("rejects blank nodes shared only between private %s graphs before any write", async (kind) => {
  const { store, write } = setup();
  const value = await sharedBlankBatchGraphs();
  const target = DataFactory.blankNode();
  for (const np of value.nanopubs) {
    const name = kind === "provenance" ? np.provenanceId : np.pubinfoId;
    const contents = graph(value.dataset, name);
    new RdfNode(np.id, contents).add(`${NS.prov}primarySource`, target);
    new RdfNode(target, contents).text(`${NS.schema}name`, "Shared evidence target");
    putGraph(value.dataset as Store, name, contents);
  }
  await expect(store.put(value)).rejects.toThrow("Unsupported cross-resource blank-node sharing");
  expect(write).not.toHaveBeenCalled();
});

it("preserves a local blank node shared between one nanopub's provenance and publication graphs", async () => {
  const { store } = setup();
  const value = await sharedBlankBatchGraphs();
  const np = value.nanopubs[0]!;
  const target = DataFactory.blankNode();
  for (const name of [np.provenanceId, np.pubinfoId]) {
    const contents = graph(value.dataset, name);
    new RdfNode(np.id, contents).add(`${NS.prov}primarySource`, target);
    new RdfNode(target, contents).text(`${NS.schema}name`, "Local evidence target");
    putGraph(value.dataset as Store, name, contents);
  }
  await store.put(value);
  expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it("rejects sharing across different batch graphs without a common graph before any write", async () => {
  const { store, write } = setup();
  const first = await sharedBlankBatchGraphs("first-batch", ["one"]);
  const second = await sharedBlankBatchGraphs("second-batch", ["two"]);
  const source = "https://example.org/document";
  const author = new RdfNode(
    source,
    graph(first.dataset, pkgId("batch", "first-batch", "sources")),
  ).one(`${NS.schema}author`);
  const other = new RdfNode(
    source,
    graph(second.dataset, pkgId("batch", "second-batch", "sources")),
  ).one(`${NS.schema}author`);
  const dataset = new Store(first.dataset);
  for (const quad of second.dataset)
    dataset.add(
      DataFactory.quad(
        quad.subject.equals(other) ? (author as typeof quad.subject) : quad.subject,
        quad.predicate,
        quad.object.equals(other) ? (author as typeof quad.object) : quad.object,
        quad.graph,
      ),
    );
  await expect(
    store.put({ dataset, nanopubs: [...first.nanopubs, ...second.nanopubs] }),
  ).rejects.toThrow("Unsupported cross-resource blank-node sharing");
  expect(write).not.toHaveBeenCalled();
});

it.each([
  false,
  true,
])("retains shared source/entity graphs and their blank-node references (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const value = await sharedBlankBatchGraphs();
  await store.put(value);
  const sourcesId = pkgId("batch", "shared-batch", "sources");
  const entitiesId = pkgId("batch", "shared-batch", "entities");
  const copies = await Promise.all(value.nanopubs.map((np) => store.get(np.id)));
  const naive = new Store(copies.flatMap((copy) => [...copy.dataset]));
  for (const name of [sourcesId, entitiesId])
    expect(graph(naive, name).size).toBeGreaterThan(graph(value.dataset, name).size);
  const list = pod.list;
  if (reverse) pod.list = async (url) => (await list(url)).reverse();
  for (let i = 0; i < 2; i++) {
    const loaded = await store.list();
    expect(loaded.nanopubs).toHaveLength(3);
    for (const name of [sourcesId, entitiesId])
      expect(graph(loaded.dataset, name).size).toBe(graph(value.dataset, name).size);
    expect(isomorphic([...loaded.dataset], [...value.dataset])).toBe(true);
    const sources = graph(loaded.dataset, sourcesId);
    const author = new RdfNode("https://example.org/document", sources).one(`${NS.schema}author`);
    const nested = new RdfNode(author, sources).one(`${NS.schema}additionalProperty`);
    const entities = graph(loaded.dataset, entitiesId);
    expect(
      new RdfNode("https://example.org/document", entities)
        .one(`${NS.schema}author`)
        .equals(author),
    ).toBe(true);
    const entity = new RdfNode("https://example.org/document", entities).one(`${NS.schema}about`);
    for (const np of loaded.nanopubs) {
      const provenance = graph(loaded.dataset, np.provenanceId);
      const envelope = new RdfNode(np.id, provenance);
      expect(envelope.one(`${NS.prov}primarySource`).equals(author)).toBe(true);
      expect(new RdfNode(author, provenance).oneIri(`${NS.prov}wasDerivedFrom`)).toBe(np.id);
      expect(new RdfNode(nested, provenance).oneText(`${NS.schema}description`)).toBe(
        np.identifier,
      );
      const local = new RdfNode(envelope.one(`${NS.prov}qualifiedAssociation`), provenance);
      expect(local.oneText(`${NS.schema}name`)).toBe(np.identifier);
      expect(local.one(`${NS.prov}entity`).equals(entity)).toBe(true);
      expect(
        new RdfNode(np.id, graph(loaded.dataset, np.pubinfoId))
          .one(`${NS.prov}primarySource`)
          .equals(entity),
      ).toBe(true);
    }
  }
});

it.each([
  "sources",
  "entities",
])("rejects conflicting stored copies of a shared %s graph", async (kind) => {
  for (const remove of [false, true]) {
    const { store, pod } = setup();
    const value = await sharedBlankBatchGraphs();
    await store.put(value);
    const np = value.nanopubs[1]!;
    const altered = await store.get(np.id);
    const name = pkgId("batch", np.batch, kind);
    const contents = graph(altered.dataset, name);
    for (const quad of [...altered.dataset])
      if (quad.graph.value === name) altered.dataset.delete(quad);
    if (!remove) {
      new RdfNode("https://example.org/document", contents).text(`${NS.schema}name`, "Changed");
      putGraph(altered.dataset as Store, name, contents);
    }
    const url = store.url(np.id);
    await pod.write(url, encode(await serializeNanopublications(altered)), "application/trig", {
      ifMatch: (await pod.read(url)).etag,
    });
    const list = pod.list;
    await expect(store.list()).rejects.toThrow("Conflicting copies");
    pod.list = async (container) => (await list(container)).reverse();
    await expect(store.list()).rejects.toThrow("Conflicting copies");
  }
});

it.each([
  false,
  true,
])("resolves symmetric blank nodes across shared graphs jointly (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const value = await sharedBlankBatchGraphs();
  const source = "https://example.org/document";
  const sourcesId = pkgId("batch", "shared-batch", "sources");
  const entitiesId = pkgId("batch", "shared-batch", "entities");
  const sources = graph(value.dataset, sourcesId);
  const author = new RdfNode(source, sources).one(`${NS.schema}author`);
  const nested = new RdfNode(author, sources).one(`${NS.schema}additionalProperty`);
  const other = DataFactory.blankNode();
  new RdfNode(source, sources).add(`${NS.schema}author`, other);
  new RdfNode(other, sources)
    .text(`${NS.schema}name`, "Avery")
    .add(`${NS.schema}additionalProperty`, nested);
  putGraph(value.dataset as Store, sourcesId, sources);
  const entities = graph(value.dataset, entitiesId);
  new RdfNode(source, entities).add(`${NS.schema}author`, other);
  new RdfNode(other, entities).text(`${NS.schema}description`, "Other document author");
  putGraph(value.dataset as Store, entitiesId, entities);
  await store.put(value);

  const np = value.nanopubs[1]!;
  const reordered = await store.get(np.id);
  const contents = graph(reordered.dataset, sourcesId);
  const reorderedDataset = new Store();
  putGraph(reorderedDataset, sourcesId, new Store([...contents].reverse()));
  for (const quad of reordered.dataset)
    if (quad.graph.value !== sourcesId) reorderedDataset.add(quad);
  reordered.dataset = reorderedDataset;
  const url = store.url(np.id);
  await pod.write(url, encode(await serializeNanopublications(reordered)), "application/trig", {
    ifMatch: (await pod.read(url)).etag,
  });
  expect(isomorphic([...(await store.get(np.id)).dataset], [...reordered.dataset])).toBe(true);
  const list = pod.list;
  if (reverse) pod.list = async (container) => (await list(container)).reverse();
  for (let i = 0; i < 2; i++) {
    const loaded = await store.list();
    expect(loaded.nanopubs).toHaveLength(3);
    expect(isomorphic([...loaded.dataset], [...value.dataset])).toBe(true);
    const retainedSources = graph(loaded.dataset, sourcesId);
    const retainedEntities = graph(loaded.dataset, entitiesId);
    expect([...new RdfNode(source, retainedSources).terms(`${NS.schema}author`)]).toHaveLength(2);
    for (const entry of loaded.nanopubs) {
      const retainedAuthor = new RdfNode(entry.id, graph(loaded.dataset, entry.provenanceId)).one(
        `${NS.prov}primarySource`,
      );
      expect(new RdfNode(retainedAuthor, retainedEntities).oneText(`${NS.schema}description`)).toBe(
        "Document author",
      );
    }
  }
});

it.each([
  false,
  true,
])("rejects ambiguous shared authors before any write (reverse triples: %s)", async (reverse) => {
  const { store, write } = setup();
  const { value } = await symmetricSharedAuthors();
  if (reverse) value.dataset = new Store([...value.dataset].reverse());
  await expect(store.put(value)).rejects.toThrow("Ambiguous shared blank-node identity");
  expect(write).not.toHaveBeenCalled();
});

it.each([
  false,
  true,
])("rejects ambiguous existing shared authors on listing (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const { value, sourcesId } = await symmetricSharedAuthors();
  // Seed external/older resources; put() must reject this dataset before writing.
  for (const [index, np] of value.nanopubs.entries()) {
    const names = [
      np.id,
      np.assertionId,
      np.provenanceId,
      np.pubinfoId,
      sourcesId,
      pkgId("batch", np.batch, "entities"),
    ];
    const dataset = new Store();
    for (const name of names) {
      const contents = graph(value.dataset, name);
      putGraph(
        dataset,
        name,
        index === 1 && name === sourcesId ? new Store([...contents].reverse()) : contents,
      );
    }
    await pod.write(
      store.url(np.id),
      encode(await serializeNanopublications({ dataset, nanopubs: [np] })),
      "application/trig",
      { ifNoneMatch: "*" },
    );
  }
  const list = pod.list;
  if (reverse) pod.list = async (container) => (await list(container)).reverse();
  for (let i = 0; i < 2; i++)
    await expect(store.list()).rejects.toThrow("Ambiguous shared blank-node identity");
});

it("rejects ambiguous shared graph nodes even in a single-resource put before any write", async () => {
  const { store, write } = setup();
  const { value } = await symmetricSharedAuthors(["one"]);
  await expect(store.put(value)).rejects.toThrow("Ambiguous shared blank-node identity");
  expect(write).not.toHaveBeenCalled();
});

it("preserves symmetric nodes confined to one resource's private graphs", async () => {
  const { store } = setup();
  const value = await sharedBlankBatchGraphs("private-symmetry", ["one"]);
  const np = value.nanopubs[0]!;
  const local = DataFactory.blankNode();
  const other = DataFactory.blankNode();
  const provenance = graph(value.dataset, np.provenanceId);
  new RdfNode(np.id, provenance).add(`${NS.schema}author`, local).add(`${NS.schema}author`, other);
  for (const node of [local, other])
    new RdfNode(node, provenance).text(`${NS.schema}name`, "Local author");
  putGraph(value.dataset as Store, np.provenanceId, provenance);
  const pubinfo = graph(value.dataset, np.pubinfoId);
  new RdfNode(np.id, pubinfo).add(`${NS.schema}author`, local);
  putGraph(value.dataset as Store, np.pubinfoId, pubinfo);
  await store.put(value);
  expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it.each([
  false,
  true,
])("distinguishes shared authors by exact literal lexical forms (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const { value, author, other, sourcesId } = await symmetricSharedAuthors();
  const sources = graph(value.dataset, sourcesId);
  new RdfNode(author, sources).text(
    `${NS.schema}dateCreated`,
    "2026-10-25T12:00:00Z",
    `${NS.xsd}dateTime`,
  );
  new RdfNode(other, sources).text(
    `${NS.schema}dateCreated`,
    "2026-10-25T12:00:00+00:00",
    `${NS.xsd}dateTime`,
  );
  putGraph(value.dataset as Store, sourcesId, sources);
  await store.put(value);
  const list = pod.list;
  if (reverse) pod.list = async (container) => (await list(container)).reverse();
  for (let i = 0; i < 2; i++)
    expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it.each([
  ["dateTime", "2026-10-25T12:00:00Z", "2026-10-25T12:00:00+00:00"],
  ["date", "2026-10-25Z", "2026-10-25"],
  ["gYear", "2026Z", "2026"],
  ["gYearMonth", "2026-10Z", "2026-10"],
])("rejects shared graphs with lexically distinct %s literals", async (datatype, first, second) => {
  const { store, pod } = setup();
  const value = await sharedBlankBatchGraphs();
  const name = pkgId("batch", "shared-batch", "sources");
  const source = "https://example.org/document";
  const contents = graph(value.dataset, name);
  const author = new RdfNode(source, contents).one(`${NS.schema}author`);
  new RdfNode(author, contents).text(`${NS.schema}dateCreated`, first, NS.xsd + datatype);
  putGraph(value.dataset as Store, name, contents);
  await store.put(value);
  expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
  const np = value.nanopubs[1]!;
  const altered = await store.get(np.id);
  const changed = graph(altered.dataset, name);
  const changedAuthor = new RdfNode(source, changed).one(`${NS.schema}author`);
  const date = new RdfNode(changedAuthor, changed);
  date.terms(`${NS.schema}dateCreated`).clear();
  date.text(`${NS.schema}dateCreated`, second, NS.xsd + datatype);
  for (const quad of [...altered.dataset])
    if (quad.graph.value === name) altered.dataset.delete(quad);
  putGraph(altered.dataset as Store, name, changed);
  const url = store.url(np.id);
  await pod.write(url, encode(await serializeNanopublications(altered)), "application/trig", {
    ifMatch: (await pod.read(url)).etag,
  });
  const list = pod.list;
  for (const reverse of [false, true]) {
    if (reverse) pod.list = async (container) => (await list(container)).reverse();
    await expect(store.list()).rejects.toThrow("Conflicting copies");
  }
});

it("keeps independent batches' blank-node source/entity descriptions distinct", async () => {
  const { store } = setup();
  const first = await sharedBlankBatchGraphs("first-batch", ["one"]);
  const second = await sharedBlankBatchGraphs("second-batch", ["two"]);
  await store.put(first);
  await store.put(second);
  const loaded = await store.list();
  expect(loaded.nanopubs).toHaveLength(2);
  expect(isomorphic([...loaded.dataset], [...first.dataset, ...second.dataset])).toBe(true);
});

it("retains remapped batch nodes when their assertion was loaded from an earlier batch", async () => {
  const { store, pod } = setup();
  const first = await sharedBlankAssertions(["seed"], "seed-batch");
  const second = await sharedBlankAssertions(["one", "two"], "later-batch");
  const assertionId = first.nanopubs[0]!.assertionId;
  const assertion = graph(first.dataset, assertionId);
  const preference = new RdfNode(identity.webId, assertion).one(`${NS.schema}hasPreference`);
  const nested = new RdfNode(preference, assertion).one(`${NS.schema}additionalProperty`);
  for (const quad of [...second.dataset])
    if (quad.graph.value === assertionId) second.dataset.delete(quad);
  putGraph(second.dataset as Store, assertionId, assertion);
  for (const kind of ["sources", "entities"]) {
    const name = pkgId("batch", "later-batch", kind);
    const contents = graph(second.dataset, name);
    new RdfNode("https://example.org/document", contents).add(`${NS.schema}author`, preference);
    new RdfNode(preference, contents).add(`${NS.schema}additionalProperty`, nested);
    new RdfNode(nested, contents).text(`${NS.schema}name`, kind);
    putGraph(second.dataset as Store, name, contents);
  }
  await store.put(first);
  await store.put(second);
  const list = pod.list;
  for (const reverse of [false, true]) {
    if (reverse) pod.list = async (url) => (await list(url)).reverse();
    const loaded = await store.list();
    expect(loaded.nanopubs).toHaveLength(3);
    expect(isomorphic([...loaded.dataset], [...first.dataset, ...second.dataset])).toBe(true);
  }
});

it("rejects inconsistent blank-node identity across shared source/entity copies", async () => {
  const { store, pod } = setup();
  const value = await sharedBlankBatchGraphs();
  await store.put(value);
  const np = value.nanopubs[1]!;
  const altered = await store.get(np.id);
  const name = pkgId("batch", np.batch, "entities");
  const entities = graph(altered.dataset, name);
  const author = new RdfNode("https://example.org/document", entities).one(`${NS.schema}author`);
  const separate = DataFactory.blankNode();
  const changed = new Store();
  for (const quad of entities)
    new RdfNode(quad.subject.equals(author) ? separate : quad.subject, changed).add(
      quad.predicate.value,
      quad.object.equals(author) ? separate : quad.object,
    );
  for (const quad of [...altered.dataset])
    if (quad.graph.value === name) altered.dataset.delete(quad);
  putGraph(altered.dataset as Store, name, changed);
  const url = store.url(np.id);
  await pod.write(url, encode(await serializeNanopublications(altered)), "application/trig", {
    ifMatch: (await pod.read(url)).etag,
  });
  const list = pod.list;
  await expect(store.list()).rejects.toThrow("Conflicting blank-node references");
  pod.list = async (container) => (await list(container)).reverse();
  await expect(store.list()).rejects.toThrow("Conflicting blank-node references");
});

it("deduplicates independently parsed copies of shared blank-node assertions on every listing", async () => {
  const { store, pod } = setup();
  const value = await sharedBlankAssertions();
  await store.put(value);
  const assertionId = value.nanopubs[0]!.assertionId;
  expect(new Set(value.nanopubs.map((np) => np.assertionId)).size).toBe(1);
  const copies = await Promise.all(value.nanopubs.map((np) => store.get(np.id)));
  expect([...copies[0]!.dataset].some((q) => q.subject.termType === "BlankNode")).toBe(true);
  const naive = new Store(copies.flatMap((copy) => [...copy.dataset]));
  expect(graph(naive, assertionId).size).toBeGreaterThan(graph(value.dataset, assertionId).size);
  for (let i = 0; i < 2; i++) {
    const loaded = await store.list();
    expect(loaded.nanopubs).toHaveLength(2);
    expect(graph(loaded.dataset, assertionId).size).toBe(4);
    expect(isomorphic([...loaded.dataset], [...value.dataset])).toBe(true);
    expect(classifyNanopublications(loaded).map((np) => np.corroboration)).toEqual([2, 2]);
  }
  const list = pod.list;
  pod.list = async (url) => (await list(url)).reverse();
  expect(isomorphic([...(await store.list()).dataset], [...value.dataset])).toBe(true);
});

it.each([
  false,
  true,
])("preserves references into shared assertion blank nodes across graphs (reverse listing: %s)", async (reverse) => {
  const { store, pod } = setup();
  const value = await sharedBlankAssertions(["one", "two", "three"]);
  const assertionId = value.nanopubs[0]!.assertionId;
  const assertion = graph(value.dataset, assertionId);
  const preference = new RdfNode(identity.webId, assertion).one(`${NS.schema}hasPreference`);
  const nested = new RdfNode(preference, assertion).one(`${NS.schema}additionalProperty`);
  for (const np of value.nanopubs) {
    const provenance = graph(value.dataset, np.provenanceId);
    const local = DataFactory.blankNode();
    new RdfNode(np.id, provenance)
      .add(`${NS.prov}primarySource`, preference)
      .add(`${NS.prov}qualifiedAssociation`, local);
    new RdfNode(preference, provenance).link(`${NS.prov}wasDerivedFrom`, np.id);
    new RdfNode(nested, provenance).text(`${NS.schema}description`, np.identifier);
    new RdfNode(local, provenance)
      .text(`${NS.schema}name`, np.identifier)
      .add(`${NS.prov}entity`, nested);
    putGraph(value.dataset as Store, np.provenanceId, provenance);
    const pubinfo = graph(value.dataset, np.pubinfoId);
    new RdfNode(np.id, pubinfo).add(`${NS.prov}primarySource`, nested);
    putGraph(value.dataset as Store, np.pubinfoId, pubinfo);
  }
  await store.put(value);
  for (const np of value.nanopubs) {
    const copy = await store.get(np.id);
    const ownPreference = new RdfNode(identity.webId, graph(copy.dataset, assertionId)).one(
      `${NS.schema}hasPreference`,
    );
    expect(
      new RdfNode(np.id, graph(copy.dataset, np.provenanceId))
        .one(`${NS.prov}primarySource`)
        .equals(ownPreference),
    ).toBe(true);
  }
  const list = pod.list;
  if (reverse) pod.list = async (url) => (await list(url)).reverse();
  for (let i = 0; i < 2; i++) {
    const loaded = await store.list();
    expect(graph(loaded.dataset, assertionId).size).toBe(assertion.size);
    expect(isomorphic([...loaded.dataset], [...value.dataset])).toBe(true);
    const retained = graph(loaded.dataset, assertionId);
    const retainedPreference = new RdfNode(identity.webId, retained).one(
      `${NS.schema}hasPreference`,
    );
    const retainedNested = new RdfNode(retainedPreference, retained).one(
      `${NS.schema}additionalProperty`,
    );
    for (const np of loaded.nanopubs) {
      const provenance = graph(loaded.dataset, np.provenanceId);
      const envelope = new RdfNode(np.id, provenance);
      expect(envelope.one(`${NS.prov}primarySource`).equals(retainedPreference)).toBe(true);
      expect(new RdfNode(retainedPreference, provenance).oneIri(`${NS.prov}wasDerivedFrom`)).toBe(
        np.id,
      );
      expect(new RdfNode(retainedNested, provenance).oneText(`${NS.schema}description`)).toBe(
        np.identifier,
      );
      const local = new RdfNode(envelope.one(`${NS.prov}qualifiedAssociation`), provenance);
      expect(local.oneText(`${NS.schema}name`)).toBe(np.identifier);
      expect(local.one(`${NS.prov}entity`).equals(retainedNested)).toBe(true);
      expect(
        new RdfNode(np.id, graph(loaded.dataset, np.pubinfoId))
          .one(`${NS.prov}primarySource`)
          .equals(retainedNested),
      ).toBe(true);
    }
  }
});

it("rejects inconsistent stored copies of a shared assertion instead of unioning them", async () => {
  const { store, pod } = setup();
  const value = await sharedBlankAssertions();
  await store.put(value);
  const np = value.nanopubs[1]!;
  const altered = await store.get(np.id);
  const assertion = graph(altered.dataset, np.assertionId);
  new RdfNode(identity.webId, assertion).text(`${NS.schema}name`, "Conflicting copy");
  putGraph(altered.dataset as Store, np.assertionId, assertion);
  const url = store.url(np.id);
  await pod.write(url, encode(await serializeNanopublications(altered)), "application/trig", {
    ifMatch: (await pod.read(url)).etag,
  });
  await expect(store.list()).rejects.toThrow("Conflicting copies");
});

it("writes owner-only ACLs before containers/data, splits nanopubs, and reloads every graph", async () => {
  const { store, pod, write } = setup();
  const source = await parseNanopublications(
    await readFile(new URL("./fixtures/synthetic.expected.trig", import.meta.url), "utf8"),
  );
  const urls = await store.put(source);
  expect(urls).toHaveLength(5);
  for (let index = 0; index < 6; index += 2) {
    const aclCall = write.mock.calls[index]!;
    const containerCall = write.mock.calls[index + 1]!;
    expect(aclCall[0]).toBe(`${containerCall[0]}.acl`);
    const dataset = await parseRdf(decode(aclCall[1]), "text/turtle");
    const acl = "http://www.w3.org/ns/auth/acl#";
    const auth = new RdfNode(`${aclCall[0]}#owner`, dataset);
    expect([...auth.terms(`${acl}agent`)].map((term) => term.value)).toEqual([identity.webId]);
    expect([...auth.terms(`${acl}accessTo`)].map((term) => term.value)).toEqual([containerCall[0]]);
    expect([...auth.terms(`${acl}default`)].map((term) => term.value)).toEqual([containerCall[0]]);
    expect([...auth.terms(`${acl}mode`)].map((term) => term.value).sort()).toEqual(
      ["Control", "Read", "Write"].map((mode) => acl + mode),
    );
    expect(auth.terms(`${acl}agentClass`).size).toBe(0);
  }
  for (const np of source.nanopubs) {
    const aclUrl = `${store.url(np.id)}.acl`;
    const resourceAcl = await parseRdf(decode((await pod.read(aclUrl)).body), "text/turtle");
    const authorization = new RdfNode(`${aclUrl}#owner`, resourceAcl);
    const acl = "http://www.w3.org/ns/auth/acl#";
    expect(resourceAcl.size).toBe(6);
    expect(authorization.oneIri(`${acl}agent`)).toBe(identity.webId);
    expect(authorization.oneIri(`${acl}accessTo`)).toBe(store.url(np.id));
    expect(authorization.terms(`${acl}default`).size).toBe(0);
    expect(write.mock.calls.findIndex((call) => call[0] === aclUrl)).toBeLessThan(
      write.mock.calls.findIndex((call) => call[0] === store.url(np.id)),
    );
    const resource = await pod.read(store.url(np.id));
    expect(resource.contentType).toBe("application/trig");
    expect((await parseNanopublications(decode(resource.body))).nanopubs).toEqual([np]);
    expect(resource.etag).toBeDefined();
    expect(write.mock.calls.find((call) => call[0] === store.url(np.id))![3]).toEqual({
      ifNoneMatch: "*",
    });
  }
  const loaded = await store.list();
  expect(isomorphic([...loaded.dataset], [...source.dataset])).toBe(true);
  expect(new Set(loaded.nanopubs.map((np) => np.id))).toEqual(
    new Set(source.nanopubs.map((np) => np.id)),
  );
  await expect(store.put(source)).rejects.toMatchObject({ status: 412 });
});

it("replaces an orphan public resource ACL conditionally before writing private bytes", async () => {
  const { store, memory, write } = setup();
  const value = await build();
  const url = store.url(value.nanopubs[0]!.id);
  const aclUrl = `${url}.acl`;
  const publicAcl = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
    <#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>;
      acl:accessTo <${url}>; acl:mode acl:Read .`;
  const before = await memory.write(aclUrl, encode(publicAcl), "text/turtle", {});
  write.mockImplementation(async (target, body, type, cond) => {
    if (target === url) {
      const dataset = await parseRdf(decode((await memory.read(aclUrl)).body), "text/turtle");
      expect(dataset.size).toBe(6);
      const authorization = new RdfNode(`${aclUrl}#owner`, dataset);
      expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#agent")).toBe(identity.webId);
      expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#accessTo")).toBe(url);
    }
    return memory.write(target, body, type, cond);
  });
  await store.put(value);
  expect(write.mock.calls.find((call) => call[0] === aclUrl)![3]).toEqual({
    ifMatch: before.etag,
  });
});

it.each([
  "read failure",
  "write failure",
  "create race",
  "replace race",
  "missing ETag",
  "weak ETag",
])("writes no private bytes after a destination ACL %s", async (failure) => {
  const { store, pod, memory, write } = setup();
  const value = await build();
  const url = store.url(value.nanopubs[0]!.id);
  const aclUrl = `${url}.acl`;
  const exists = ["replace race", "missing ETag", "weak ETag"].includes(failure);
  if (exists) await memory.write(aclUrl, encode("existing ACL"), "text/turtle", {});
  pod.read = async (target) => {
    if (target === aclUrl && failure === "read failure") throw statusError(403);
    const result = await memory.read(target);
    return target === aclUrl && failure.endsWith("ETag")
      ? { ...result, etag: failure === "weak ETag" ? 'W/"one"' : undefined }
      : result;
  };
  write.mockImplementation(async (target, body, type, cond) => {
    if (target === aclUrl) {
      if (failure === "write failure") throw statusError(403);
      if (failure.endsWith("race"))
        await memory.write(target, encode("concurrent ACL"), "text/turtle", {});
    }
    return memory.write(target, body, type, cond);
  });
  if (failure.endsWith("ETag")) await expect(store.put(value)).rejects.toThrow("strong ETag");
  else
    await expect(store.put(value)).rejects.toMatchObject({
      status: failure.endsWith("race") ? 412 : 403,
    });
  expect(write.mock.calls.some((call) => call[0] === url)).toBe(false);
  await expect(memory.read(url)).rejects.toMatchObject({ status: 404 });
  if (failure.endsWith("race"))
    expect(decode((await memory.read(aclUrl)).body)).toBe("concurrent ACL");
});

it("keeps writes private on ACL failure and retries initialization on a later call", async () => {
  const { store, write } = setup();
  const value = await build();
  write.mockRejectedValueOnce(statusError(403));
  await expect(store.put(value)).rejects.toMatchObject({ status: 403 });
  expect(write.mock.calls).toHaveLength(1);
  expect(write.mock.calls[0]![0]).toBe(`${identity.root}private/.acl`);
  await expect(store.put(value)).resolves.toHaveLength(1);
});

it.each([
  "nanopub",
  "policy",
])("initializes a fresh %s store when ACL writes implicitly create CSS containers", async (operation) => {
  const { store, pod, memory, write } = setup();
  const implicitlyCreated: string[] = [];
  write.mockImplementation(async (url, body, type, cond) => {
    // CSS has already created these containers while processing their ACL PUTs.
    if (url.endsWith("/")) throw statusError(409);
    const result = await memory.write(url, body, type, cond);
    if (url.endsWith("/.acl")) {
      const container = url.slice(0, -4);
      await memory.write(container, encode(""), "text/turtle", { ifNoneMatch: "*" });
      implicitlyCreated.push(container);
    }
    return result;
  });
  if (operation === "nanopub") await expect(store.put(await build())).resolves.toHaveLength(1);
  else await expect(store.writeDefaultPolicy()).resolves.toHaveProperty("id", store.policyUrl);
  expect(implicitlyCreated).toEqual(
    ["private/", "private/pkg/", "private/pkg/mcp/"].map((path) => identity.root + path),
  );
  expect(write.mock.calls.some((call) => call[0].endsWith("/"))).toBe(false);
  for (const url of implicitlyCreated) {
    const dataset = await parseRdf(decode((await pod.read(`${url}.acl`)).body), "text/turtle");
    expect(
      new RdfNode(`${url}.acl#owner`, dataset).oneIri("http://www.w3.org/ns/auth/acl#agent"),
    ).toBe(identity.webId);
  }
  const firstPrivateWrite = write.mock.calls.findIndex((call) => !call[0].endsWith(".acl"));
  expect(firstPrivateWrite).toBeGreaterThan(2);
});

it("fails closed if container state cannot be rechecked after its ACL write", async () => {
  const { store, pod, memory, write } = setup();
  let aclWritten = false;
  write.mockImplementation(async (url, body, type, cond) => {
    const result = await memory.write(url, body, type, cond);
    aclWritten = true;
    return result;
  });
  pod.read = async (url) => {
    if (url === `${identity.root}private/` && aclWritten) throw statusError(403);
    return memory.read(url);
  };
  await expect(store.put(await build())).rejects.toMatchObject({ status: 403 });
  expect(write.mock.calls).toHaveLength(1);
  expect(write.mock.calls[0]![0]).toBe(`${identity.root}private/.acl`);
});

it("conditionally replaces only the store's ACL and retains existing containers", async () => {
  const { store, pod, write } = setup();
  await store.put(await build());
  write.mockClear();
  await new NanopubStore(pod).put(await build("second"));
  expect(write.mock.calls.filter((call) => call[0].endsWith(".acl"))).toHaveLength(2);
  expect(write.mock.calls[0]![0]).toBe(`${store.container}.acl`);
  expect(write.mock.calls[0]![3].ifMatch).toBeDefined();
  expect(write.mock.calls[1]![3]).toEqual({ ifNoneMatch: "*" });
  expect(write.mock.calls.some((call) => call[0].endsWith("/"))).toBe(false);
});

it.each([
  true,
  false,
])("preserves shared ancestor ACL bytes and ETags with existing containers: %s", async (containersExist) => {
  const { store, pod, memory, write } = setup();
  const ancestors = ["private/", "private/pkg/"].map((path) => identity.root + path);
  const before = [];
  for (const url of ancestors) {
    // An unrelated authorization, including inherited public access, belongs to the owner.
    const aclBody = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
      <#other-app> a acl:Authorization; acl:agent <https://example.org/other-client>;
        acl:accessTo <${url}>; acl:default <${url}>; acl:mode acl:Read .`;
    await memory.write(`${url}.acl`, encode(aclBody), "text/turtle", {});
    if (containersExist) await memory.write(url, encode(""), "text/turtle", {});
    before.push(await pod.read(`${url}.acl`));
  }
  write.mockClear();
  const value = await build();
  await store.put(value);
  for (const [i, url] of ancestors.entries()) {
    expect(await pod.read(`${url}.acl`)).toEqual(before[i]);
    expect(write.mock.calls.some((call) => call[0] === `${url}.acl`)).toBe(false);
  }
  expect(
    write.mock.calls.filter((call) => call[0].endsWith(".acl")).map((call) => call[0]),
  ).toEqual([`${store.container}.acl`, `${store.url(value.nanopubs[0]!.id)}.acl`]);
  const aclCall = write.mock.calls.findIndex((call) => call[0] === `${store.container}.acl`);
  const dataCall = write.mock.calls.findIndex((call) => call[0].endsWith(".trig"));
  expect(aclCall).toBeLessThan(dataCall);
});

it("leaves existing shared ancestors without local ACLs untouched", async () => {
  const { store, memory, write } = setup();
  for (const path of ["private/", "private/pkg/"])
    await memory.write(identity.root + path, encode(""), "text/turtle", {});
  const value = await build();
  await store.put(value);
  expect(
    write.mock.calls.filter((call) => call[0].endsWith(".acl")).map((call) => call[0]),
  ).toEqual([`${store.container}.acl`, `${store.url(value.nanopubs[0]!.id)}.acl`]);
});

it("uses only octet-stream, preserving exact TriG bytes after a 415 rejection", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation(async (url, body, type, cond) => {
    if (type === "application/trig")
      throw new Error("failed to write: HTTP 415 Unsupported Media Type");
    return memory.write(url, body, type, cond);
  });
  const value = await build();
  await store.put(value);
  const writes = write.mock.calls.filter((call) => call[0].endsWith(".trig"));
  expect(writes.map((call) => call[2])).toEqual(["application/trig", "application/octet-stream"]);
  expect(writes[0]![1]).toEqual(writes[1]![1]);
  expect((await store.get(value.nanopubs[0]!.id)).nanopubs).toEqual(value.nanopubs);
});

it.each([
  "bytes",
  "type",
])("falls back with the read-back ETag when the server rewrites %s", async (mode) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) =>
    memory.write(
      url,
      type === "application/trig" && mode === "bytes" ? encode("flattened RDF") : body,
      type === "application/trig" && mode === "type" ? "text/turtle" : type,
      cond,
    ),
  );
  const value = await build();
  await store.put(value);
  const calls = write.mock.calls.filter((call) => call[0].endsWith(".trig"));
  expect(calls[1]![3].ifMatch).toBeDefined();
  expect(calls[1]![1]).toEqual(calls[0]![1]);
  expect((await store.get(value.nanopubs[0]!.id)).nanopubs).toEqual(value.nanopubs);
});

it.each([401, 403, 412, 500])("does not treat HTTP %i as TriG rejection", async (status) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(status));
    return memory.write(url, body, type, cond);
  });
  await expect(store.put(await build())).rejects.toMatchObject({ status });
  expect(write.mock.calls.some((call) => call[2] === "application/octet-stream")).toBe(false);
});

it.each(["missing", "weak"])("refuses a rewritten representation with a %s ETag", async (kind) => {
  const { store, pod, memory } = setup();
  pod.read = async (url) => {
    const result = await memory.read(url);
    return url.endsWith(".trig")
      ? { ...result, body: encode("rewritten"), etag: kind === "weak" ? 'W/"one"' : undefined }
      : result;
  };
  await expect(store.put(await build())).rejects.toThrow("strong ETag");
});

it.each(["bytes", "type"])("fails if octet-stream fallback does not preserve %s", async (kind) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(415));
    return memory.write(
      url,
      type === "application/octet-stream" && kind === "bytes" ? new Uint8Array() : body,
      type === "application/octet-stream" && kind === "type" ? "text/plain" : type,
      cond,
    );
  });
  await expect(store.put(await build())).rejects.toThrow("did not preserve");
});

it("propagates a fallback write failure without another representation", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(415));
    if (type === "application/octet-stream") return Promise.reject(statusError(403));
    return memory.write(url, body, type, cond);
  });
  await expect(store.put(await build())).rejects.toMatchObject({ status: 403 });
});

it("never follows poisoned or nested listing URLs and deduplicates entries", async () => {
  const { store, pod } = setup();
  const value = await build();
  await store.put(value);
  const valid = { url: store.url(value.nanopubs[0]!.id), isContainer: false };
  pod.list = async () => [
    valid,
    valid,
    { url: `${store.container}nested/`, isContainer: true },
    { url: "https://evil.example/one.trig", isContainer: false },
    { url: `${store.container}unknown.trig`, isContainer: false },
    { url: valid.url.slice(0, -5), isContainer: false },
    { url: `${valid.url}/nested.trig`, isContainer: false },
    { url: `${valid.url}?query`, isContainer: false },
  ];
  expect((await store.list()).nanopubs).toHaveLength(1);
});

it("returns an empty view for an empty container", async () => {
  const { store } = setup();
  expect((await store.list()).dataset.size).toBe(0);
});

it.each([
  { root: "not a URL" },
  { root: "file:///pod/" },
  { root: "https://example.org/pod" },
  { root: "https://example.org/pod/?x=/" },
  { root: "https://example.org/pod/#x" },
  { root: "https://user@example.org/pod/" },
  { root: "https://:pass@example.org/pod/" },
  { root: "https://example.org/pod/unsafe>" },
  { webId: "" },
  { webId: "https://example.org/unsafe>" },
])("rejects an unsafe storage identity %j", (overrides) => {
  expect(() => setup({ ...identity, ...overrides })).toThrow();
});

it("validates UUID inputs, RDF and stored identity before using data", async () => {
  const { store, memory, write } = setup();
  for (const id of ["../secret", "https://evil.example/a", "urn:uuid:not-a-uuid"])
    await expect(store.get(id)).rejects.toThrow("UUID");
  await expect(store.put({ dataset: new Store(), nanopubs: [] })).rejects.toThrow(
    "No nanopublications",
  );
  expect(write).not.toHaveBeenCalled();
  const value = await build();
  const id = value.nanopubs[0]!.id;
  expect(() => store.url(`${id}\n`)).toThrow("UUID");
  const url = store.url(id);
  await memory.write(url, encode(await serializeNanopublications(value)), "text/plain", {});
  await expect(store.get(id)).rejects.toThrow("media type");
  await memory.write(
    url,
    encode(await serializeNanopublications(await build("other"))),
    "application/trig",
    {},
  );
  await expect(store.get(id)).rejects.toThrow("identity mismatch");
  const multiple = await buildNanopublications(
    {
      batch_id: "multiple",
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "one@example.org",
          }),
          epistemic: "Mentioned",
        },
        {
          id: "two",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "two@example.org",
          }),
          epistemic: "Mentioned",
        },
      ],
    },
    options,
  );
  await memory.write(
    url,
    encode(await serializeNanopublications(multiple)),
    "application/trig",
    {},
  );
  await expect(store.get(id)).rejects.toThrow("identity mismatch");
  await memory.write(url, new Uint8Array([255]), "application/trig", {});
  await expect(store.get(id)).rejects.toThrow();
});

it.each([
  { template: "email", value: "avery@example.org" },
  { template: "preference", value: { propertyID: "drink", value: "tea" } },
  {
    template: "medication",
    value: {
      id: "https://example.org/intake",
      medication: { id: "https://example.org/medicine", name: "Example medicine" },
      dose: { value: "1", unit: "tablet", frequency: "daily" },
    },
  },
] satisfies Fact[])("retracts $template without changing its assertion identity or original bytes", async (fact) => {
  const { store, pod } = setup();
  const value = await build("store", fact);
  await store.put(value);
  const previous = value.nanopubs[0]!;
  const before = await pod.read(store.url(previous.id));
  const now = "2026-10-26T12:00:00Z";
  const revision = await store.retract(previous.id, {
    batchId: "retraction",
    clientId: "https://example.org/client",
    generatedAt: now,
  });
  const np = revision.nanopubs[0]!;
  expect(np.id).not.toBe(previous.id);
  expect(np.assertionId).toBe(previous.assertionId);
  const originalAssertion = graph(value.dataset, previous.assertionId);
  const withdrawnAssertion = graph(revision.dataset, np.assertionId);
  expect([...withdrawnAssertion].every((q) => originalAssertion.has(q))).toBe(true);
  expect(withdrawnAssertion.size).toBe(originalAssertion.size);
  expect(isomorphic([...revision.dataset], [...(await store.get(np.id)).dataset])).toBe(true);
  expect(new Set([...revision.dataset].map((q) => q.graph.value))).toEqual(
    new Set([
      np.id,
      previous.assertionId,
      np.provenanceId,
      np.pubinfoId,
      pkgId("batch", "retraction", "sources"),
    ]),
  );
  expect(np.supersedes).toEqual([previous.assertionId]);
  expect(
    new RdfNode(np.id, graph(revision.dataset, np.provenanceId)).oneIri(`${NS.prov}wasRevisionOf`),
  ).toBe(previous.id);
  expect(np.validity).toBe("Retracted");
  expect(np.attributedTo).toEqual([identity.webId]);
  expect(np.agent).toBe("https://example.org/client");
  expect(
    new RdfNode(np.assertionId, graph(revision.dataset, np.provenanceId)).oneDateTime(
      `${NS.prov}invalidatedAtTime`,
    ),
  ).toBe("2026-10-26T12:00:00+00:00");
  expect(await pod.read(store.url(previous.id))).toEqual(before);
  const classified = classifyNanopublications(await store.list());
  expect(classified.map((item) => item.belief)).toEqual(["past", "past"]);
  expect(classified.map((item) => item.corroboration)).toEqual([2, 2]);
  expect(classified.find((item) => item.id === previous.id)!.replacedBy).toEqual([np.id]);
  const reassertion = await build("remember-again", fact, "2026-10-27T12:00:00Z");
  await store.put(reassertion);
  const remembered = reassertion.nanopubs[0]!;
  expect(remembered.assertionId).toBe(previous.assertionId);
  const history = await store.list();
  for (const nanopubs of [history.nanopubs, [...history.nanopubs].reverse()]) {
    const result = classifyNanopublications({ ...history, nanopubs });
    expect(result.find((item) => item.id === remembered.id)).toMatchObject({
      validity: "Current",
      belief: "definitely",
      replacedBy: [],
      corroboration: 3,
    });
    expect(result.find((item) => item.id === previous.id)).toMatchObject({
      belief: "past",
      replacedBy: [np.id],
    });
  }
  expect(
    classifyNanopublications({
      ...history,
      nanopubs: history.nanopubs.filter((item) => item.id !== previous.id),
    }).find((item) => item.id === remembered.id)!.belief,
  ).toBe("definitely");
  const simultaneous = await store.retract(previous.id, {
    batchId: "same-clock",
    clientId: np.agent,
    generatedAt: previous.generatedAt,
  });
  expect(simultaneous.nanopubs[0]!.validity).toBe("Retracted");
  await expect(
    store.retract(previous.id, {
      batchId: "too-early",
      clientId: np.agent,
      generatedAt: "2025-01-01T00:00:00Z",
    }),
  ).rejects.toThrow("predates");
  const clock = vi.useFakeTimers().setSystemTime(new Date("2026-10-27T12:00:00Z"));
  try {
    await store.retract(previous.id, { batchId: "default-clock", clientId: np.agent });
  } finally {
    clock.useRealTimers();
  }
  const secondWithdrawal = await store.retract(remembered.id, {
    batchId: "forget-again",
    clientId: np.agent,
    generatedAt: "2026-10-28T12:00:00Z",
  });
  const final = classifyNanopublications(await store.list());
  expect(final.find((item) => item.id === remembered.id)).toMatchObject({
    belief: "past",
    replacedBy: [secondWithdrawal.nanopubs[0]!.id],
  });
  expect(final.find((item) => item.id === previous.id)!.replacedBy).not.toContain(
    secondWithdrawal.nanopubs[0]!.id,
  );
});

it("writes a default policy once behind the ACL, preserving owner edits", async () => {
  const { store, pod, memory, write } = setup();
  const policy = await store.writeDefaultPolicy();
  expect(write.mock.calls.at(-1)![0]).toBe(store.policyUrl);
  const aclCall = write.mock.calls.at(-2)!;
  expect(aclCall[0]).toBe(`${store.policyUrl}.acl`);
  const policyAcl = await parseRdf(decode(aclCall[1]), "text/turtle");
  const authorization = new RdfNode(`${store.policyUrl}.acl#owner`, policyAcl);
  expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#agent")).toBe(identity.webId);
  expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#accessTo")).toBe(store.policyUrl);
  expect(authorization.terms("http://www.w3.org/ns/auth/acl#default").size).toBe(0);
  expect(
    purposeFilter(
      policy,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:MedicalHealth"] }),
  ).toBe(false);
  const edited = { ...policy, permissions: [] };
  await memory.write(store.policyUrl, encode(await policyToTurtle(edited)), "text/turtle", {});
  write.mockClear();
  const read = await new NanopubStore(pod).writeDefaultPolicy();
  expect(
    purposeFilter(
      read,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:Contact"] }),
  ).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("does not write a policy if its dedicated ACL fails", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) =>
    url === `${store.policyUrl}.acl`
      ? Promise.reject(statusError(403))
      : memory.write(url, body, type, cond),
  );
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 403 });
  expect(write.mock.calls.some((call) => call[0] === store.policyUrl)).toBe(false);
});

it("rejects a retraction earlier by one microsecond", async () => {
  const { store } = setup();
  const original = await buildNanopublications(
    {
      batch_id: "microseconds",
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          epistemic: "SelfReportedExplicit",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "avery@example.org",
          }),
        },
      ],
    },
    { ...options, generatedAt: "2026-10-25T12:00:00.000501Z" },
  );
  await store.put(original);
  await expect(
    store.retract(original.nanopubs[0]!.id, {
      batchId: "microseconds-retract",
      clientId: "https://example.org/client",
      generatedAt: "2026-10-25T12:00:00.000500Z",
    }),
  ).rejects.toThrow("predates");
});

it("preserves a concurrent first-run policy writer", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation(async (url, body, type, cond) => {
    if (url === store.policyUrl) {
      await memory.write(
        url,
        encode(await policyToTurtle({ id: url, permissions: [] })),
        type,
        cond,
      );
      throw statusError(412);
    }
    return memory.write(url, body, type, cond);
  });
  expect(
    purposeFilter(
      await store.writeDefaultPolicy(),
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:Contact"] }),
  ).toBe(false);
});

it("fails on unreadable, invalid or failed policy documents", async () => {
  const { store, pod, memory, write } = setup();
  pod.read = async () => {
    throw statusError(403);
  };
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 403 });
  expect(write).not.toHaveBeenCalled();
  pod.read = memory.read;
  await memory.write(store.policyUrl, encode(""), "text/turtle", {});
  await expect(store.writeDefaultPolicy()).rejects.toThrow("No memory policy");
  await memory.delete(store.policyUrl);
  write.mockImplementation((url, body, type, cond) =>
    url === store.policyUrl
      ? Promise.reject(statusError(500))
      : memory.write(url, body, type, cond),
  );
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 500 });
});

it("the memory PodPort enforces conditions and copies bytes", async () => {
  const pod = createMemoryPodPort(identity);
  const url = `${identity.root}data`;
  const body = encode("original");
  const result = await pod.write(url, body, "text/plain", { ifNoneMatch: "*" });
  body[0] = 0;
  const read = await pod.read(url);
  expect(decode(read.body)).toBe("original");
  read.body[0] = 0;
  expect(decode((await pod.read(url)).body)).toBe("original");
  await expect(pod.write(url, body, "text/plain", { ifNoneMatch: "*" })).rejects.toMatchObject({
    status: 412,
  });
  await expect(pod.delete(url, { ifMatch: '"wrong"' })).rejects.toMatchObject({ status: 412 });
  await pod.write(url, encode("updated"), "text/plain", { ifMatch: result.etag });
  await pod.write(`${identity.root}nested/`, body, "text/turtle", {});
  await pod.write(`${identity.root}nested/deep/data`, body, "text/plain", {});
  expect(await pod.list(identity.root)).toEqual([
    { url, isContainer: false },
    { url: `${identity.root}nested/`, isContainer: true },
  ]);
  await pod.delete(url);
  await expect(pod.delete(url)).rejects.toMatchObject({ status: 404 });
});

it("recognizes PodPort status errors without interpreting arbitrary messages", () => {
  expect(podStatus(statusError(404))).toBe(404);
  expect(podStatus(new Error("failed to read: HTTP 404 Not Found"))).toBe(404);
  for (const value of [
    null,
    undefined,
    "404",
    404,
    {},
    { status: "404" },
    new Error("network failure"),
  ])
    expect(podStatus(value)).not.toBe(404);
});
