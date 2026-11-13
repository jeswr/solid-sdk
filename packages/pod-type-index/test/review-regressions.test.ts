// AUTHORED-BY Codex GPT-6
import { StorageError } from "@jeswr/storage-client";
import { DataFactory, Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import { createTypeIndex } from "../src/index.js";
import {
  addRegistration,
  CLASS,
  CONTAINER,
  emptyDocument,
  INSTANCE,
  PUBLIC,
  pointer,
  REGISTRATION,
  Resource,
  resource,
  serialize,
  TYPE,
} from "../src/rdf.js";
import { createMemoryStorage } from "../src/testing.js";

const ROOT = "https://pod.example/alice/";
const CARD = `${ROOT}profile/card`;
const WEBID = `${CARD}#me`;
const INDEX = `${ROOT}settings/index.ttl`;
const FOR_CLASS = "urn:Example";
const TARGET = `${ROOT}one`;
const SOLID = "http://www.w3.org/ns/solid/terms#";

async function setup(body = "") {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.write(CARD, `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`, {
    ifMatch: "*",
    contentType: "text/turtle",
  });
  await storage.write(INDEX, body, { ifMatch: "*", contentType: "text/turtle" });
  return {
    storage,
    index: createTypeIndex({ storage, features: storage.features, profile: WEBID }),
  };
}

afterEach(() => vi.restoreAllMocks());

it.each([
  false,
  true,
])("retains safe URL normalization before checking mutation targets (container=%s)", async (container) => {
  const { storage, index } = await setup();
  const target = `${ROOT}a^b${container ? "/" : ""}`;
  const location = container ? { container: target } : { instance: target };
  await index.register(FOR_CLASS, location);
  expect(await index.find(FOR_CLASS)).toEqual([new URL(target).href]);
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  await index.register(FOR_CLASS, location);
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  await index.unregister(FOR_CLASS, location);
  expect(await index.find(FOR_CLASS)).toEqual([]);
});

it.each([
  ["https://pod.example/alice/a|b#r", FOR_CLASS, TARGET],
  [`${INDEX}#r`, "urn:Example|Class", TARGET],
  [`${INDEX}#r`, FOR_CLASS, `${ROOT}a|b`],
])("defends the RDF build boundary against unsafe subject/class/target (%s %s %s)", (subject, iri, target) => {
  const document = emptyDocument(INDEX);
  resource(document, INDEX).values("urn:annotation").add("urn:keep");
  const before = [...document.dataset];
  const build = vi.spyOn(entities.TypeRegistration, "build");
  for (const container of [false, true]) {
    expect(() => addRegistration(document, subject, iri, target, container)).toThrow(StorageError);
    expect(() => addRegistration(document, subject, iri, target, container)).toThrow(
      expect.objectContaining({ code: "scope", url: INDEX }),
    );
  }
  expect(build).not.toHaveBeenCalled();
  expect([...document.dataset]).toEqual(before);
});

it.each([
  false,
  true,
])("rejects a generated shell before copying any quads (container=%s)", (container) => {
  const document = emptyDocument(INDEX);
  resource(document, INDEX).values("urn:annotation").add("urn:keep");
  const before = [...document.dataset];
  const build = entities.TypeRegistration.build;
  vi.spyOn(entities.TypeRegistration, "build").mockImplementation((subject, data) =>
    build(subject, { forClass: data.forClass }),
  );
  expect(() => addRegistration(document, `${INDEX}#r`, FOR_CLASS, TARGET, container)).toThrow(
    expect.objectContaining({ code: "scope" }),
  );
  expect([...document.dataset]).toEqual(before);
});

it.each([
  ["existing", false],
  ["existing", true],
  ["fresh", false],
  ["fresh", true],
] as const)("never writes a generated registration missing its exact location (%s, container=%s)", async (state, container) => {
  const { storage, index } = await setup();
  if (state === "fresh")
    await storage.delete(INDEX, { ifMatch: (await storage.head(INDEX)).etag as string });
  const build = entities.TypeRegistration.build;
  vi.spyOn(entities.TypeRegistration, "build").mockImplementation((subject, data) =>
    build(subject, {
      ...data,
      ...(container ? { instanceContainer: [`${ROOT}wrong/`] } : { instance: [`${ROOT}wrong`] }),
    }),
  );
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  await expect(
    index.register(FOR_CLASS, container ? { container: `${ROOT}many/` } : { instance: TARGET }),
  ).rejects.toMatchObject({ code: "scope" });
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  if (state === "existing") expect((await storage.readRdf(INDEX)).dataset.size).toBe(0);
  else await expect(storage.head(INDEX)).rejects.toMatchObject({ code: "not-found" });
});

it.each([
  "urn:unknown",
  "toString",
  "__proto__",
])("returns an empty pointer set for an unknown predicate (%s)", (predicate) => {
  const document = emptyDocument(CARD);
  const subject = resource(document, WEBID);
  const value = pointer(subject, predicate);
  expect(value).toBeInstanceOf(Set);
  expect([...value]).toEqual([]);
  expect(document.dataset.size).toBe(0);
});

it("maps an unsafe direct Profile wrapper subject to StorageError", () => {
  const subject = resource(emptyDocument(CARD), `${WEBID}|x`);
  expect(() => pointer(subject, PUBLIC)).toThrow(StorageError);
  expect(() => pointer(subject, PUBLIC)).toThrow(expect.objectContaining({ code: "scope" }));
});

it.each(
  [false, true].flatMap((blank) =>
    [false, true].flatMap((container) =>
      [CLASS, container ? CONTAINER : INSTANCE, TYPE].map((failedPredicate) => ({
        blank,
        container,
        failedPredicate,
      })),
    ),
  ),
)("aborts removal without persisting a missed delete (%j)", async ({
  blank,
  container,
  failedPredicate,
}) => {
  const target = container ? `${ROOT}many/` : TARGET;
  const subject = blank ? "_:r" : `<${INDEX}#r>`;
  const { storage, index } = await setup(`
    ${subject} a <${REGISTRATION}>, <urn:OtherType> ; <${CLASS}> <${FOR_CLASS}> ;
      <${container ? CONTAINER : INSTANCE}> <${target}> ; <urn:annotation> "keep" .
  `);
  const before = await (await storage.read(INDEX)).text();
  const missed = new Set<string>();
  const deletion = vi.spyOn(missed, "delete").mockReturnValue(false);
  if (blank || failedPredicate === TYPE) {
    const values = Resource.prototype.values;
    vi.spyOn(Resource.prototype, "values").mockImplementation(function (predicate) {
      return predicate === failedPredicate ? missed : values.call(this, predicate);
    });
  } else {
    const field =
      failedPredicate === CLASS ? "forClass" : container ? "instanceContainer" : "instance";
    vi.spyOn(entities.TypeRegistration.Wrapper.prototype, field, "get").mockReturnValue(missed);
  }
  const read = storage.readRdf;
  const documents: Awaited<ReturnType<typeof read>>[] = [];
  vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
    const document = await read(url, options);
    if (url === INDEX) documents.push(document);
    return document;
  });
  const write = vi.spyOn(storage, "writeRdf");
  const create = vi.spyOn(storage, "create");
  await expect(
    index.unregister(FOR_CLASS, container ? { container: target } : { instance: target }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(deletion).toHaveBeenCalledTimes(3);
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(documents).toHaveLength(3);
  for (const document of documents) {
    expect(
      document.dataset.match(null, DataFactory.namedNode(TYPE), DataFactory.namedNode(REGISTRATION))
        .size,
    ).toBe(1);
  }
  expect(await (await storage.read(INDEX)).text()).toBe(before);
});

it.each([
  new Error("N3 failure"),
  new TypeError("RDF serialization failed", { cause: new Error("nested") }),
])("preserves N3 callback error identity (%s)", async (failure) => {
  vi.spyOn(Writer.prototype, "end").mockImplementationOnce(function (callback) {
    callback(failure, "");
    return this;
  });
  await expect(serialize(emptyDocument(INDEX))).rejects.toBe(failure);
});
