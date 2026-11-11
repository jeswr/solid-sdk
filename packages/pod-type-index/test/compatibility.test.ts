// AUTHORED-BY Codex (GPT-6.1 Sol)
import { StorageError } from "@jeswr/storage-client";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store, Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import { createTypeIndex } from "../src/index.js";
import { emptyDocument, resource, serialize, TYPE } from "../src/rdf.js";
import { createMemoryStorage } from "../src/testing.js";

const ROOT = "https://pod.example/alice/";
const CARD = `${ROOT}profile/card`;
const WEBID = `${CARD}#me`;
const INDEX = `${ROOT}settings/index.ttl`;
const CLASS = "urn:Example";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PREFIX = `@prefix solid: <${SOLID}> .`;

async function setup(body: string, contentType = "text/turtle") {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.write(CARD, `${PREFIX}<${WEBID}> solid:privateTypeIndex <${INDEX}>.`, {
    ifMatch: "*",
    contentType: "text/turtle",
  });
  await storage.write(INDEX, PREFIX + body, { ifMatch: "*", contentType });
  return {
    storage,
    index: createTypeIndex({ storage, features: storage.features, profile: WEBID }),
  };
}

afterEach(() => vi.restoreAllMocks());

it("lists independently-subjected registrations and preserves tolerant named-node sets", async () => {
  const { index, storage } = await setup(`
    <#one> a solid:TypeRegistration ; solid:forClass <${CLASS}>, "bad", <urn:Other> ;
      solid:instance <${ROOT}résumé>, "bad", [] ;
      solid:instanceContainer <${ROOT}many/>, <https://foreign.example/private> .
    <${ROOT}outside-fragment> a solid:TypeRegistration ; solid:forClass <${CLASS}> ;
      solid:instance <${ROOT}two> .
    <urn:registration> a solid:TypeRegistration ; solid:forClass <${CLASS}> ;
      solid:instance <${ROOT}three> .
    _:blank a solid:TypeRegistration ; solid:forClass <${CLASS}> ; solid:instance <${ROOT}four> .
    <#invalid> a solid:TypeRegistration ; solid:forClass "bad" ; solid:instance "bad" .
    <#untyped> solid:forClass <${CLASS}> ; solid:instance <${ROOT}ignored> .
  `);
  const locations = [
    new URL(`${ROOT}résumé`).href,
    `${ROOT}many/`,
    `${ROOT}two`,
    `${ROOT}three`,
    `${ROOT}four`,
  ];
  expect(await index.find(CLASS)).toEqual(locations);
  expect(await index.find("urn:Other")).toEqual(locations.slice(0, 2));
  const before = await (await storage.read(INDEX)).text();
  const write = vi.spyOn(storage, "writeRdf");
  await index.register(CLASS, { instance: `${ROOT}résumé` });
  expect(write).not.toHaveBeenCalled();
  expect(await (await storage.read(INDEX)).text()).toBe(before);
});

it("keeps named-graph values out of generated registration and profile reads", async () => {
  const { index, storage } = await setup(
    `
    <#r> a solid:TypeRegistration ; solid:forClass <${CLASS}> ; solid:instance <${ROOT}one> .
    <urn:graph> { <#r> solid:forClass <urn:Hidden> ; solid:instance <${ROOT}hidden> . }
  `,
    "application/trig",
  );
  await storage.write(
    CARD,
    `${PREFIX}
    <${WEBID}> solid:privateTypeIndex <${INDEX}> .
    <urn:graph> { <${WEBID}> solid:publicTypeIndex <${ROOT}never-read> . }
  `,
    { ifMatch: "*", contentType: "application/trig" },
  );
  const read = vi.spyOn(storage, "readRdf");
  expect(await index.findAll([CLASS, "urn:Hidden"])).toEqual(
    new Map([
      [CLASS, [`${ROOT}one`]],
      ["urn:Hidden", []],
    ]),
  );
  expect(read.mock.calls.map(([url]) => url)).toEqual([CARD, INDEX]);
});

it.each([
  "instance",
  "instanceContainer",
])("removes a blank-node %s without changing its annotations", async (predicate) => {
  const target = predicate === "instance" ? `${ROOT}one` : `${ROOT}many/`;
  const { index, storage } = await setup(`
    _:r a solid:TypeRegistration, <urn:OtherType> ; solid:forClass <${CLASS}> ;
      solid:${predicate} <${target}> ; <urn:annotation> "keep" .
  `);
  await index.unregister(
    CLASS,
    predicate === "instance" ? { instance: target } : { container: target },
  );
  const document = await storage.readRdf(INDEX);
  expect(
    [...document.dataset].map((q) => [q.subject.termType, q.predicate.value, q.object.value]),
  ).toEqual([
    ["BlankNode", TYPE, "urn:OtherType"],
    ["BlankNode", "urn:annotation", "keep"],
  ]);
  expect(await index.find(CLASS)).toEqual([]);
});

it.each([
  `solid:forClass <${CLASS}>, "bad" ; solid:instance <${ROOT}one>`,
  `solid:forClass <${CLASS}> ; solid:instance <${ROOT}one>, "bad"`,
  `solid:forClass <${CLASS}> ; solid:instance <${ROOT}one> ; solid:instanceContainer <${ROOT}many/>`,
])("rejects raw removal ambiguity even when generated sets omit bad members: %s", async (fields) => {
  const { index, storage } = await setup(`<#r> a solid:TypeRegistration ; ${fields} .`);
  const write = vi.spyOn(storage, "writeRdf");
  await expect(index.unregister(CLASS, { instance: `${ROOT}one` })).rejects.toMatchObject({
    code: "conflict",
  });
  expect(write).not.toHaveBeenCalled();
});

it("writes profile pointers without asserting Agent or changing existing RDF", async () => {
  const { storage, index } = await setup("");
  await index.register(CLASS, { instance: `${ROOT}one` }, { index: "public" });
  const card = await storage.readRdf(CARD);
  expect([...card.dataset].some((q) => q.predicate.value === TYPE)).toBe(false);
  expect(await index.find(CLASS)).toEqual([`${ROOT}one`]);
  const document = await storage.readRdf(`${ROOT}settings/publicTypeIndex.ttl`);
  expect(entities.TypeIndex.parse(document.url, document.dataset)).toEqual({});
  expect([...document.dataset].some((q) => q.object.value === `${SOLID}ListedDocument`)).toBe(true);
});

// Exact divergences: strict runtime subject and serialization integrity guards.
it("ignores a relative named registration subject from an injected RDF dataset", async () => {
  const { storage, index } = await setup("");
  const read = storage.readRdf;
  vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
    const document = await read(url, options);
    if (url === INDEX)
      document.dataset = new Store(
        new Parser().parse(`${PREFIX}
      <relative> a solid:TypeRegistration ; solid:forClass <${CLASS}> ; solid:instance <${ROOT}one> .
    `),
      );
    return document;
  });
  expect(await index.find(CLASS)).toEqual([]);
});

it("rejects unsafe unrelated IRIs at serialization without rewriting their identity", async () => {
  const document = emptyDocument(INDEX);
  const subject = resource(document, INDEX);
  subject.values("urn:annotation").add("https://example.org/has space");
  await expect(serialize(document)).rejects.toThrow(TypeError);
  expect(subject.iris("urn:annotation")).toEqual(["https://example.org/has space"]);
});

it.each([
  [DataFactory.namedNode("relative"), "urn:p", DataFactory.namedNode("urn:o")],
  [DataFactory.namedNode(INDEX), "relative", DataFactory.namedNode("urn:o")],
  [DataFactory.blankNode("bad label"), "urn:p", DataFactory.namedNode("urn:o")],
  [DataFactory.namedNode(INDEX), "urn:p", DataFactory.literal("x", "bad_tag")],
  [
    DataFactory.namedNode(INDEX),
    "urn:p",
    DataFactory.literal("x", DataFactory.namedNode("relative")),
  ],
])("rejects RDF terms that cannot retain their identity in Turtle (%s %s %s)", async (subject, predicate, object) => {
  const document = emptyDocument(INDEX);
  const view = new TermWrapper(subject, document.dataset, DataFactory);
  SetFrom.subjectPredicate(view, predicate, TermAs.term, TermFrom.itself).add(object);
  const before = [...document.dataset];
  await expect(serialize(document)).rejects.toThrow(TypeError);
  expect([...document.dataset]).toEqual(before);
});

it("rejects a serializer result that silently loses triples", async () => {
  const document = emptyDocument(INDEX);
  resource(document, INDEX).values("urn:annotation").add("urn:keep");
  vi.spyOn(Writer.prototype, "end").mockImplementationOnce(function (callback) {
    callback(null, "");
    return this;
  });
  await expect(serialize(document)).rejects.toThrow("round-trip integrity");
  expect(document.dataset.size).toBe(1);
});

it("keeps the N3 serialization of valid RDF byte-compatible and leaves the dataset untouched", async () => {
  const document = emptyDocument(INDEX);
  document.dataset = new Store(
    new Parser({ baseIRI: INDEX }).parse(`${PREFIX}
    <> a solid:TypeIndex, solid:UnlistedDocument .
    <#r> a solid:TypeRegistration ; solid:forClass <${CLASS}> ; solid:instance <${ROOT}one> .
    _:annotation <urn:label> "kept"@en .
  `),
  );
  const original = [...document.dataset];
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads(original);
  const expected = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  expect(await serialize(document)).toBe(expected);
  expect([...document.dataset]).toEqual(original);
  expect(document.dataset.match(DataFactory.namedNode(INDEX)).size).toBe(2);
});

// AUTHORED-BY Codex GPT-6
// Exact divergences: runtime IRI safety at the facade and on stored JSON-LD data.
it.each([
  "|",
  "{",
  "}",
  "^",
])("rejects a runtime-unsafe WebID with StorageError/scope (%s)", (character) => {
  const storage = createMemoryStorage({ root: ROOT });
  const read = vi.spyOn(storage, "readRdf");
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  expect(() =>
    createTypeIndex({ storage, features: storage.features, profile: `${WEBID}${character}x` }),
  ).toThrow(expect.objectContaining({ name: "StorageError", code: "scope", url: ROOT }));
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("rejects a runtime-unsafe storage root with StorageError/scope", () => {
  const root = `${ROOT}a|b/`;
  const storage = createMemoryStorage({ root });
  const read = vi.spyOn(storage, "readRdf");
  const create = vi.spyOn(storage, "create");
  expect(() =>
    createTypeIndex({ storage, features: storage.features, profile: `${root}profile/card#me` }),
  ).toThrow(expect.objectContaining({ name: "StorageError", code: "scope", url: root }));
  expect(read).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

const unsafePaths = ["a^b", "doc#a{b", "doc#a}b", "doc#a|b", "doc#a^b"];
const pointerPredicates = [
  `${SOLID}publicTypeIndex`,
  `${SOLID}privateTypeIndex`,
  "http://www.w3.org/ns/pim/space#preferencesFile",
];

it.each(
  pointerPredicates.flatMap((predicate) => unsafePaths.map((path) => ({ predicate, path }))),
)("hides runtime-unsafe stored pointers on discovery and rejects strict mutations (%j)", async ({
  predicate,
  path,
}) => {
  const { storage, index } = await setup(`
    <#r> a solid:TypeRegistration ; solid:forClass <${CLASS}> ; solid:instance <${ROOT}keep> .
  `);
  const unsafe = ROOT + path;
  const visibility = predicate === pointerPredicates[0] ? "public" : "private";
  const safePredicate = visibility === "public" ? pointerPredicates[1] : pointerPredicates[0];
  await storage.write(
    CARD,
    JSON.stringify({
      "@id": WEBID,
      [predicate]: [{ "@id": unsafe }],
      [safePredicate as string]: [{ "@id": INDEX }],
    }),
    { ifMatch: "*", contentType: "application/ld+json" },
  );
  const card = await storage.readRdf(CARD);
  expect(
    card.dataset.match(null, DataFactory.namedNode(predicate), DataFactory.namedNode(unsafe)).size,
  ).toBe(1);
  const before = await (await storage.read(CARD)).text();
  const read = vi.spyOn(storage, "readRdf");
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  expect(await index.find(CLASS)).toEqual([`${ROOT}keep`]);
  expect(read.mock.calls.map(([url]) => url)).toEqual([CARD, INDEX]);
  for (const operation of [index.register, index.unregister]) {
    await expect(
      operation(CLASS, { instance: `${ROOT}one` }, { index: visibility }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "scope",
      url: ROOT,
    });
  }
  expect(read.mock.calls.every(([url]) => url !== unsafe)).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(await (await storage.read(CARD)).text()).toBe(before);
});

it.each(
  ["instance", "instanceContainer"].flatMap((predicate) =>
    unsafePaths.map((path) => ({ predicate, path })),
  ),
)("hides runtime-unsafe stored locations while retaining valid siblings (%j)", async ({
  predicate,
  path,
}) => {
  const { storage, index } = await setup("");
  const unsafe = ROOT + path;
  const keep = `${ROOT}keep/`;
  await storage.write(
    INDEX,
    JSON.stringify({
      "@id": `${INDEX}#r`,
      "@type": [`${SOLID}TypeRegistration`],
      [`${SOLID}forClass`]: [{ "@id": CLASS }],
      [`${SOLID}${predicate}`]: [{ "@id": unsafe }, { "@id": keep }],
    }),
    { ifMatch: "*", contentType: "application/ld+json" },
  );
  const document = await storage.readRdf(INDEX);
  expect(
    document.dataset.match(
      null,
      DataFactory.namedNode(SOLID + predicate),
      DataFactory.namedNode(unsafe),
    ).size,
  ).toBe(1);
  const before = await (await storage.read(INDEX)).text();
  expect(await index.find(CLASS)).toEqual([keep]);
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  // Raw evidence still counts the hidden value, preventing a destructive partial removal.
  await expect(
    index.unregister(CLASS, predicate === "instance" ? { instance: keep } : { container: keep }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(await (await storage.read(INDEX)).text()).toBe(before);
});

it.each([
  { instance: `${ROOT}a|b` },
  { instance: `${ROOT}doc#a{b` },
  { instance: `${ROOT}doc#a}b` },
  { instance: `${ROOT}doc#a|b` },
  { instance: `${ROOT}doc#a^b` },
  { container: `${ROOT}a|b/` },
  { container: `${ROOT}doc#a{b/` },
  { container: `${ROOT}doc#a}b/` },
  { container: `${ROOT}doc#a|b/` },
  { container: `${ROOT}doc#a^b/` },
])("rejects runtime-unsafe mutation targets before I/O (%j)", async (location) => {
  const { storage, index } = await setup("");
  const read = vi.spyOn(storage, "readRdf");
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(index.register(CLASS, location)).rejects.toBeInstanceOf(StorageError);
    await expect(index.register(CLASS, location)).rejects.toMatchObject({
      code: "scope",
      url: ROOT,
    });
    await expect(index.unregister(CLASS, location)).rejects.toMatchObject({ code: "scope" });
  }
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("rejects an absolute-looking class that the runtime cannot parse before I/O", async () => {
  const { storage, index } = await setup("");
  const read = vi.spyOn(storage, "readRdf");
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  for (const operation of [index.register, index.unregister]) {
    await expect(
      operation("https://[invalid]/Class", { instance: `${ROOT}one` }),
    ).rejects.toMatchObject({
      code: "scope",
      url: ROOT,
    });
  }
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
