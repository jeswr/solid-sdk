// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildMemory,
  type MemoryData,
  MemoryItem,
  memorySubject,
  parseMemory,
  parseMemoryTtl,
  serializeMemory,
} from "./memory.js";
import { MEMORY_CLASS } from "./vocab.js";

const URL_ = "https://alice.pod/memories/m1";

describe("memorySubject", () => {
  it("roots the memory at #it", () => {
    expect(memorySubject(URL_)).toBe(`${URL_}#it`);
  });
});

describe("round-trip (build → serialize → parseMemoryTtl)", () => {
  it("preserves every field", async () => {
    const data: MemoryData = {
      text: "Alice prefers dark mode and lives in Sydney.",
      created: new Date("2026-06-01T10:00:00.000Z"),
      modified: new Date("2026-06-02T11:30:00.000Z"),
      keywords: ["preference", "ui"],
      categories: ["https://w3id.org/jeswr/memory#cat-personal", "http://schema.org/Preference"],
      about: "https://example.org/topics/dark-mode",
      attributedTo: "https://agent.pod/profile/card#me",
      generatedBy: "https://alice.pod/chat/room1#it",
      embeddingRef: "https://alice.pod/memories/m1.embedding",
    };
    const ttl = await serializeMemory(URL_, data);
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(parsed).toBeDefined();
    if (!parsed) throw new Error("unreachable");
    expect(parsed.text).toBe(data.text);
    expect(parsed.created?.toISOString()).toBe(data.created?.toISOString());
    expect(parsed.modified?.toISOString()).toBe(data.modified?.toISOString());
    expect(new Set(parsed.keywords)).toEqual(new Set(data.keywords));
    expect(new Set(parsed.categories)).toEqual(new Set(data.categories));
    expect(parsed.about).toBe(data.about);
    expect(parsed.attributedTo).toBe(data.attributedTo);
    expect(parsed.generatedBy).toBe(data.generatedBy);
    expect(parsed.embeddingRef).toBe(data.embeddingRef);
  });
});

describe("http(s)-IRI scope filtering on object properties", () => {
  it.each([
    ["javascript:alert(1)"],
    ["mailto:bob@example.com"],
    ["not-a-url"],
    ["urn:uuid:1234"],
    [""],
  ])("drops a non-http(s) value %s for about/attributedTo/generatedBy/embeddingRef", async (bad) => {
    const data: MemoryData = {
      text: "x",
      about: bad,
      attributedTo: bad,
      generatedBy: bad,
      embeddingRef: bad,
    };
    const ttl = await serializeMemory(URL_, data);
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(parsed?.about).toBeUndefined();
    expect(parsed?.attributedTo).toBeUndefined();
    expect(parsed?.generatedBy).toBeUndefined();
    expect(parsed?.embeddingRef).toBeUndefined();
  });

  it("drops a non-http(s) category entry but keeps valid ones", async () => {
    const data: MemoryData = {
      text: "x",
      categories: ["https://valid.example/cat", "javascript:bad", "mailto:x@y.z"],
    };
    const ttl = await serializeMemory(URL_, data);
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(parsed?.categories).toEqual(["https://valid.example/cat"]);
  });

  it("keeps free-text keywords verbatim (no IRI filter)", async () => {
    const data: MemoryData = { text: "x", keywords: ["not a url", "mailto-like", "café"] };
    const ttl = await serializeMemory(URL_, data);
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(new Set(parsed?.keywords)).toEqual(new Set(data.keywords));
  });

  it("drops non-http(s) object-property IRIs stored by a HOSTILE pod on READ", async () => {
    // A hostile resource that puts non-http(s) NamedNode objects directly into the
    // graph (bypassing buildMemory's write-side filter). parseMemory must apply the
    // SAME http(s)-only filter on read so it never surfaces a javascript:/mailto:/urn:
    // IRI to a consumer (which might render it as a link).
    const body = `@prefix mem: <https://w3id.org/jeswr/memory#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix schema: <http://schema.org/> .
<${URL_}#it> a mem:MemoryItem ;
  schema:text "hostile" ;
  dct:subject <javascript:alert(1)> ;
  prov:wasAttributedTo <mailto:evil@x.y> ;
  prov:wasGeneratedBy <urn:uuid:abc> ;
  mem:embeddingRef <javascript:steal()> ;
  schema:about <https://ok.example/cat>, <javascript:bad>, <mailto:c@d.e> .`;
    const parsed = await parseMemoryTtl(URL_, body, "text/turtle");
    expect(parsed).toBeDefined();
    expect(parsed?.about).toBeUndefined();
    expect(parsed?.attributedTo).toBeUndefined();
    expect(parsed?.generatedBy).toBeUndefined();
    expect(parsed?.embeddingRef).toBeUndefined();
    // Only the single valid http(s) category survives.
    expect(parsed?.categories).toEqual(["https://ok.example/cat"]);
  });
});

describe("the not-siloed memory↔chat link", () => {
  it("round-trips a prov:wasGeneratedBy → as:Note IRI", async () => {
    const note = "https://alice.pod/chat/2026/06/01/chat.ttl#msg-7";
    const ttl = await serializeMemory(URL_, { text: "from a note", generatedBy: note });
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(parsed?.generatedBy).toBe(note);
  });

  it("round-trips a prov:wasGeneratedBy → pod-chat pc:ChatRoom IRI", async () => {
    const room = "https://alice.pod/chat/room1#it";
    const ttl = await serializeMemory(URL_, { text: "from a room", generatedBy: room });
    const parsed = await parseMemoryTtl(URL_, ttl, "text/turtle");
    expect(parsed?.generatedBy).toBe(room);
  });
});

describe("class guard + defaults", () => {
  it("parseMemory returns undefined when the subject is not a mem:MemoryItem", async () => {
    // A document with a triple at #it but NO mem:MemoryItem type.
    const body = `<${URL_}#it> <http://schema.org/text> "orphan body" .`;
    const parsed = await parseMemoryTtl(URL_, body, "text/turtle");
    expect(parsed).toBeUndefined();
  });

  it("buildMemory stamps mem:MemoryItem and defaults created to now", () => {
    const before = Date.now();
    const store = buildMemory(URL_, { text: "hi" });
    const doc = new MemoryItem(memorySubject(URL_), store, DataFactory);
    expect(doc.isMemory).toBe(true);
    const parsed = parseMemory(URL_, store);
    expect(parsed?.created).toBeInstanceOf(Date);
    expect(parsed?.created?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("buildMemory writes the mem:MemoryItem type into the graph", async () => {
    const ttl = await serializeMemory(URL_, { text: "typed" });
    expect(ttl).toContain(MEMORY_CLASS.replace("https://w3id.org/jeswr/memory#", "mem:"));
  });

  it("text defaults to empty string when absent on a typed subject", async () => {
    const body = `@prefix mem: <https://w3id.org/jeswr/memory#> .
<${URL_}#it> a mem:MemoryItem .`;
    const parsed = await parseMemoryTtl(URL_, body, "text/turtle");
    expect(parsed).toBeDefined();
    expect(parsed?.text).toBe("");
  });
});

describe("parseMemoryTtl content-type coalescing", () => {
  it("treats a null content-type as text/turtle", async () => {
    const ttl = await serializeMemory(URL_, { text: "null ct" });
    const parsed = await parseMemoryTtl(URL_, ttl, null);
    expect(parsed?.text).toBe("null ct");
  });
});
