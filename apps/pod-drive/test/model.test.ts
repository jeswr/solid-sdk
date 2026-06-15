// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  DriveContainer,
  DriveContainerDataset,
  DriveResource,
  isFolder,
  readContainer,
  resourceSubject,
} from "../src/model.js";
import { turtle } from "./helpers.js";

const FULL = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix posix: <http://www.w3.org/ns/posix/stat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix poddrive: <https://w3id.org/jeswr/pod-drive#> .

<https://pod.example/drive/> a ldp:Container, ldp:BasicContainer, poddrive:DriveRoot ;
  ldp:contains
    <https://pod.example/drive/photos/>,
    <https://pod.example/drive/notes.txt>,
    <https://pod.example/drive/zeta.bin>,
    <https://pod.example/drive/apple.txt> .

<https://pod.example/drive/photos/> a ldp:Container ;
  dcterms:modified "2026-06-10T08:00:00Z"^^xsd:dateTime .

<https://pod.example/drive/notes.txt> a ldp:Resource ;
  posix:size 1234 ;
  dcterms:modified "2026-06-15T10:00:00Z"^^xsd:dateTime ;
  dcterms:format "text/plain" .

<https://pod.example/drive/zeta.bin> a ldp:Resource ;
  posix:size 9999 ;
  posix:mtime 1700000000 .

<https://pod.example/drive/apple.txt> a ldp:Resource .
`;

describe("DriveContainer", () => {
  const c = readContainer("https://pod.example/drive/", turtle(FULL));

  it("readContainer returns a DriveContainer anchored at the url", () => {
    expect(c).toBeInstanceOf(DriveContainer);
    expect(c.url).toBe("https://pod.example/drive/");
    expect(c.id).toBe("https://pod.example/drive/");
  });

  it("contains is a Set-like of DriveResource children", () => {
    // @rdfjs/wrapper returns a WrappingSet (implements Set<T>, not instanceof Set).
    const set = c.contains;
    expect(typeof set.has).toBe("function");
    expect(set.size).toBe(4);
    for (const r of set) {
      expect(r).toBeInstanceOf(DriveResource);
    }
  });

  it("entries sorts folders first, then files alphabetically", () => {
    expect(c.entries.map((e) => e.name)).toEqual([
      "photos", // folder first
      "apple.txt",
      "notes.txt",
      "zeta.bin",
    ]);
  });

  it("an empty / unknown container has zero entries", () => {
    const empty = readContainer("https://pod.example/empty/", turtle(FULL));
    expect(empty.entries).toEqual([]);
    expect(empty.contains.size).toBe(0);
  });
});

describe("DriveResource", () => {
  const c = readContainer("https://pod.example/drive/", turtle(FULL));
  const byName = (n: string): DriveResource => {
    const r = c.entries.find((e) => e.name === n);
    if (!r) {
      throw new Error(`missing ${n}`);
    }
    return r;
  };

  it("url aliases id", () => {
    const notes = byName("notes.txt");
    expect(notes.url).toBe("https://pod.example/drive/notes.txt");
    expect(notes.url).toBe(notes.id);
  });

  it("isContainer is true for folders, false for files", () => {
    expect(byName("photos").isContainer).toBe(true);
    expect(byName("notes.txt").isContainer).toBe(false);
  });

  it("size reads posix:size when present, undefined otherwise", () => {
    expect(byName("notes.txt").size).toBe(1234);
    expect(byName("apple.txt").size).toBeUndefined();
  });

  it("contentType reads dcterms:format", () => {
    expect(byName("notes.txt").contentType).toBe("text/plain");
    expect(byName("zeta.bin").contentType).toBeUndefined();
  });

  it("modifiedAt prefers dcterms:modified", () => {
    expect(byName("notes.txt").modifiedAt?.toISOString()).toBe("2026-06-15T10:00:00.000Z");
  });

  it("modifiedAt falls back to posix:mtime epoch integer", () => {
    const zeta = byName("zeta.bin");
    // @solid/object's lastModified reads mtime via LiteralAs.date, which throws
    // on an xsd:integer — modifiedAt swallows that and uses the epoch fallback.
    expect(() => zeta.lastModified).toThrow();
    expect(zeta.modifiedAt).toEqual(new Date(1700000000 * 1000));
  });

  it("modifiedAt is undefined when no timestamp is present", () => {
    expect(byName("apple.txt").modifiedAt).toBeUndefined();
  });

  it("isDriveRoot reflects the poddrive:DriveRoot type", () => {
    const root = new DriveResource("https://pod.example/drive/", turtle(FULL), DataFactory);
    expect(root.isDriveRoot).toBe(true);
    expect(byName("notes.txt").isDriveRoot).toBe(false);
  });
});

describe("model edge cases", () => {
  it("safeOptional swallows a wrong-typed posix:size (IRI instead of literal)", () => {
    const bad = turtle(`
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      @prefix posix: <http://www.w3.org/ns/posix/stat#> .
      <https://pod.example/drive/> ldp:contains <https://pod.example/drive/x> .
      <https://pod.example/drive/x> posix:size <https://pod.example/not-a-number> .
    `);
    const c = readContainer("https://pod.example/drive/", bad);
    const x = [...c.contains][0];
    expect(x?.size).toBeUndefined();
  });

  it("modifiedAt swallows a wrong-typed posix:mtime", () => {
    const bad = turtle(`
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      @prefix posix: <http://www.w3.org/ns/posix/stat#> .
      <https://pod.example/drive/> ldp:contains <https://pod.example/drive/x> .
      <https://pod.example/drive/x> posix:mtime <https://pod.example/nope> .
    `);
    const x = [...readContainer("https://pod.example/drive/", bad).contains][0];
    expect(x?.modifiedAt).toBeUndefined();
  });

  it("contentType swallows a wrong-typed dcterms:format", () => {
    const bad = turtle(`
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      @prefix dcterms: <http://purl.org/dc/terms/> .
      <https://pod.example/drive/> ldp:contains <https://pod.example/drive/x> .
      <https://pod.example/drive/x> dcterms:format <https://pod.example/iri-format> .
    `);
    const x = [...readContainer("https://pod.example/drive/", bad).contains][0];
    expect(x?.contentType).toBeUndefined();
  });

  it("name decodes percent-encoded segments", () => {
    const enc = turtle(`
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <https://pod.example/drive/> ldp:contains <https://pod.example/drive/my%20file.txt> .
    `);
    const x = [...readContainer("https://pod.example/drive/", enc).contains][0];
    expect(x?.name).toBe("my file.txt");
  });

  it("isFolder narrows a resource", () => {
    const c = readContainer("https://pod.example/drive/", turtle(FULL));
    const photos = c.entries.find((e) => e.name === "photos");
    const notes = c.entries.find((e) => e.name === "notes.txt");
    expect(photos && isFolder(photos)).toBe(true);
    expect(notes && isFolder(notes)).toBe(false);
  });

  it("resourceSubject mints a NamedNode for a url", () => {
    const s = resourceSubject("https://pod.example/drive/notes.txt");
    expect(s.termType).toBe("NamedNode");
    expect(s.value).toBe("https://pod.example/drive/notes.txt");
  });
});

describe("DriveContainerDataset", () => {
  it("exposes the container as a DriveContainer", () => {
    const ds = new DriveContainerDataset(turtle(FULL), DataFactory);
    const container = ds.container;
    expect(container).toBeInstanceOf(DriveContainer);
    expect(container?.url).toBe("https://pod.example/drive/");
    expect(container?.entries.length).toBe(4);
  });

  it("returns undefined when the dataset names no container", () => {
    const ds = new DriveContainerDataset(
      turtle(`<https://pod.example/x> <https://pod.example/p> "v" .`),
      DataFactory,
    );
    expect(ds.container).toBeUndefined();
  });
});
