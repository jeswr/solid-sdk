// AUTHORED-BY Codex
import { DataFactory, Parser, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addTrashRecord,
  emptyTrashIndex,
  removeTrashRecord,
  serializeTrashIndex,
  type TrashEntry,
  trashEntries,
  trashIndexFrom,
} from "../src/apps/drive/lib/operations/trash-index";

const PROV = "http://www.w3.org/ns/prov#";
const ROOT = "https://alice.demo.pod/drive/";
const NOW = new Date("2026-10-26T12:00:00Z");
const entry: TrashEntry = {
  url: `${ROOT}.trash/slot/notes.md`,
  original: `${ROOT}notes.md`,
  trashedAt: NOW,
  trashedBy: "https://alice.demo.pod/profile/card#me",
  name: "notes.md",
  contentType: "text/markdown",
  size: 0,
};

afterEach(() => vi.restoreAllMocks());

describe("PROV trash index", () => {
  it("round-trips the pending intent's source version identities through typed accessors", async () => {
    const index = emptyTrashIndex();
    addTrashRecord(index, entry);
    const versions = [
      JSON.stringify([entry.original, '"source"']),
      JSON.stringify([`${entry.original}/nested`, '"child"']),
    ];
    for (const version of versions) index.record(entry.url).sourceVersions.add(version);
    const restored = trashIndexFrom(
      new Store(new Parser().parse(await serializeTrashIndex(index))),
    );
    expect([...restored.record(entry.url).sourceVersions]).toEqual(versions);
    // Replacing a record also discards the previous intent's identities.
    addTrashRecord(restored, entry);
    expect(restored.record(entry.url).sourceVersions.size).toBe(0);
  });

  it("round-trips partial recovery state through typed accessors and Turtle", async () => {
    const index = emptyTrashIndex();
    const partial = { ...entry, status: "partial" as const };
    addTrashRecord(index, partial);
    const restored = trashIndexFrom(
      new Store(new Parser().parse(await serializeTrashIndex(index))),
    );
    expect(trashEntries(restored)).toEqual([partial]);
  });

  it("round-trips every accessor through Turtle and sorts newest first", async () => {
    const index = emptyTrashIndex();
    expect(index.records).toEqual([]);
    expect(trashEntries(index)).toEqual([]);
    const older = {
      ...entry,
      url: `${ROOT}.trash/older/notes.md`,
      trashedAt: new Date("2026-10-25T12:00:00Z"),
      size: 42,
    };
    addTrashRecord(index, older);
    addTrashRecord(index, entry);
    const text = await serializeTrashIndex(index);
    const dataset = new Store(new Parser().parse(text));
    expect(
      dataset.getSubjects(
        DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        DataFactory.namedNode(`${PROV}Entity`),
        null,
      ),
    ).toHaveLength(2);
    const restored = trashIndexFrom(dataset);
    expect(trashEntries(restored)).toEqual([entry, older]);
    expect(restored.record(entry.url).types.has(`${PROV}Entity`)).toBe(true);
    expect(restored.record(entry.url).size).toBe(0);
  });

  it("replaces all old properties and removes a record without touching its peers", async () => {
    const index = emptyTrashIndex();
    addTrashRecord(index, entry);
    const peer = { ...entry, url: `${ROOT}.trash/peer/notes.md` };
    addTrashRecord(index, peer);
    const minimal: TrashEntry = {
      url: entry.url,
      original: `${ROOT}renamed`,
      name: "renamed",
      trashedAt: NOW,
    };
    addTrashRecord(index, minimal);
    expect(trashEntries(index)).toEqual(expect.arrayContaining([peer, minimal]));
    expect(trashEntries(index)).toHaveLength(2);
    const record = index.record(entry.url);
    expect(record.trashedBy).toBeUndefined();
    expect(record.format).toBeUndefined();
    expect(record.size).toBeUndefined();
    removeTrashRecord(index, entry.url);
    removeTrashRecord(index, entry.url);
    expect(trashEntries(index)).toEqual([peer]);
    const roundTrip = trashIndexFrom(
      new Store(new Parser().parse(await serializeTrashIndex(index))),
    );
    expect(trashEntries(roundTrip)).toEqual([peer]);
    expect([...index.match(DataFactory.namedNode(entry.url), undefined, undefined)]).toEqual([]);
  });

  it("clears optional required accessors and falls back to decoded original names", () => {
    const index = emptyTrashIndex();
    addTrashRecord(index, entry);
    const record = index.record(entry.url);
    record.title = undefined;
    record.originalLocation = `${ROOT}Caf%C3%A9%20notes/`;
    expect(trashEntries(index)[0]?.name).toBe("Café notes");
    record.originalLocation = undefined;
    expect(trashEntries(index)).toEqual([]);
    record.originalLocation = entry.original;
    record.trashedAt = undefined;
    expect(trashEntries(index)).toEqual([]);
  });

  it("skips missing, invalid-date, wrong-typed and undecodable records while retaining valid peers", () => {
    // Intentionally malformed external RDF is parsed through N3, not manufactured by accessors.
    const dataset = new Store(
      new Parser().parse(`
      @prefix prov: <${PROV}>.
      @prefix dct: <http://purl.org/dc/terms/>.
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
      <urn:no-original> a prov:Entity; prov:invalidatedAtTime "2026-10-26T12:00:00Z"^^xsd:dateTime.
      <urn:no-date> a prov:Entity; prov:wasDerivedFrom <${ROOT}notes.md>.
      <urn:bad-date> a prov:Entity; prov:wasDerivedFrom <${ROOT}notes.md>; prov:invalidatedAtTime "oops"^^xsd:dateTime.
      <urn:wrong-term> a prov:Entity; prov:wasDerivedFrom "not an IRI"; prov:invalidatedAtTime "2026-10-26T12:00:00Z"^^xsd:dateTime.
      <urn:wrong-date-term> a prov:Entity; prov:wasDerivedFrom <${ROOT}notes.md>; prov:invalidatedAtTime <urn:date>.
      <urn:bad-encoding> a prov:Entity; prov:wasDerivedFrom <${ROOT}bad%zz>; prov:invalidatedAtTime "2026-10-26T12:00:00Z"^^xsd:dateTime.
      <urn:without-title> a prov:Entity; prov:wasDerivedFrom <${ROOT}Work/>; prov:invalidatedAtTime "2026-10-26T12:00:00Z"^^xsd:dateTime.
    `),
    );
    const index = trashIndexFrom(dataset);
    addTrashRecord(index, entry);
    expect(trashEntries(index)).toEqual([
      { url: "urn:without-title", original: `${ROOT}Work/`, trashedAt: NOW, name: "Work" },
      entry,
    ]);
  });

  it("rejects a serialization failure instead of resolving partial Turtle", async () => {
    const error = new Error("writer failure");
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => {
      callback?.(error, "");
    });
    await expect(serializeTrashIndex(emptyTrashIndex())).rejects.toBe(error);
  });
});
