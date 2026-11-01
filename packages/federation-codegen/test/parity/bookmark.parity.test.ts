// AUTHORED-BY Claude Opus 4.8
// PARITY: @jeswr/solid-bookmark's src/bookmark.test.ts, VERBATIM except the import
// lines are repointed at the generated model's facade. A green run proves the
// generated wrapper reproduces the hand-written model's behaviour (the parity bar).
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  BOOK_ARCHIVED,
  BOOK_NOTES,
  BOOKMARK_CLASS,
  Bookmark,
  type BookmarkData,
  bookmarkSubject,
  buildBookmark,
  isHttpIri,
  parseBookmark,
  parseBookmarkTtl,
  SCHEMA_KEYWORDS,
  SCHEMA_URL,
  serializeBookmark,
} from "../../examples/bookmark/facade.js";

const RES = "http://localhost:3000/alice/bookmarks/x";
const SUBJ = bookmarkSubject(RES);
const URL_ = "https://example.org/article";

/** Parse a Turtle string into an n3 Store for assertions. */
function toStore(ttl: string): Store {
  return new Store(new Parser({ baseIRI: RES }).parse(ttl));
}

describe("buildBookmark", () => {
  it("stamps rdf:type book:Bookmark on the #it subject", () => {
    const store = buildBookmark(RES, { url: URL_ });
    expect(
      store.getQuads(SUBJ, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", BOOKMARK_CLASS, null)
        .length,
    ).toBe(1);
  });

  it("writes the url as an IRI (NamedNode), not a literal", () => {
    const store = buildBookmark(RES, { url: URL_ });
    const q = store.getQuads(SUBJ, SCHEMA_URL, null, null);
    expect(q).toHaveLength(1);
    expect(q[0]?.object.termType).toBe("NamedNode");
    expect(q[0]?.object.value).toBe(URL_);
  });

  it("DROPS a non-http(s) url (untrusted-input filter — no malformed/hostile NamedNode)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "nota url",
    ]) {
      const store = buildBookmark(RES, { url: bad });
      expect(store.getQuads(SUBJ, SCHEMA_URL, null, null)).toHaveLength(0);
    }
  });

  it("writes book:archived as an xsd:boolean, defaulting to false", () => {
    const store = buildBookmark(RES, { url: URL_ });
    const q = store.getQuads(SUBJ, BOOK_ARCHIVED, null, null);
    expect(q).toHaveLength(1);
    expect(q[0]?.object.value).toBe("false");
    expect(q[0]?.object.termType).toBe("Literal");
  });

  it("writes each tag as a schema:keywords string literal, skipping blanks", () => {
    const store = buildBookmark(RES, { url: URL_, tags: ["rust", "  ", "solid", ""] });
    const tags = store.getQuads(SUBJ, SCHEMA_KEYWORDS, null, null).map((q) => q.object.value);
    expect(tags.sort()).toEqual(["rust", "solid"]);
  });

  it("writes notes as a book:notes literal distinct from dct:description", () => {
    const store = buildBookmark(RES, {
      url: URL_,
      description: "short blurb",
      notes: "# Markdown\n\nlong body",
    });
    expect(store.getQuads(SUBJ, BOOK_NOTES, null, null)[0]?.object.value).toBe(
      "# Markdown\n\nlong body",
    );
    expect(
      store.getQuads(SUBJ, "http://purl.org/dc/terms/description", null, null)[0]?.object.value,
    ).toBe("short blurb");
  });
});

describe("round-trip (serialize with n3.Writer → parse back)", () => {
  it("a fully-populated bookmark round-trips through Turtle", async () => {
    const data: BookmarkData = {
      url: URL_,
      title: "Great article",
      description: "A blurb.",
      notes: "My **notes**.",
      archived: true,
      tags: ["solid", "rdf"],
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-10T11:00:00.000Z"),
    };
    const ttl = await serializeBookmark(RES, data);
    expect(ttl).toContain("book:");
    expect(ttl).toContain("schema:url");

    const back = parseBookmark(RES, toStore(ttl));
    expect(back).toEqual({
      url: URL_,
      title: "Great article",
      description: "A blurb.",
      notes: "My **notes**.",
      archived: true,
      tags: ["rdf", "solid"], // parseBookmark sorts tags for a stable projection
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-10T11:00:00.000Z"),
    });
  });

  it("a minimal bookmark (url only) round-trips; archived defaults false, created auto-set", async () => {
    const ttl = await serializeBookmark(RES, { url: URL_ });
    const back = parseBookmark(RES, toStore(ttl));
    expect(back?.url).toBe(URL_);
    expect(back?.archived).toBe(false);
    expect(back?.created).toBeInstanceOf(Date);
    expect(back?.title).toBeUndefined();
    expect(back?.tags).toBeUndefined();
  });

  it("parseBookmark returns undefined for a subject that is not a book:Bookmark", () => {
    const store = toStore(`<${SUBJ}> <${SCHEMA_URL}> <${URL_}> .`);
    expect(parseBookmark(RES, store)).toBeUndefined();
  });

  it("parseBookmark REJECTS a hostile non-http(s) schema:url from untrusted pod RDF (read filter)", () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      "data:text/html,alert(1)",
      "file:///etc/passwd",
    ]) {
      const store = toStore(`
        @prefix book:   <https://w3id.org/jeswr/bookmark#> .
        @prefix schema: <http://schema.org/> .
        @prefix dct:    <http://purl.org/dc/terms/> .
        <${SUBJ}> a book:Bookmark ; schema:url <${bad}> ; dct:title "Trap" .
      `);
      expect(parseBookmark(RES, store)).toBeUndefined();
    }
  });

  it("parseBookmark returns undefined for a book:Bookmark with NO schema:url", () => {
    const store = toStore(`
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix dct:  <http://purl.org/dc/terms/> .
      <${SUBJ}> a book:Bookmark ; dct:title "No url" .
    `);
    expect(parseBookmark(RES, store)).toBeUndefined();
  });

  it("parseBookmark accepts a valid http(s) schema:url (positive control for the read filter)", () => {
    const store = toStore(`
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      @prefix dct:    <http://purl.org/dc/terms/> .
      <${SUBJ}> a book:Bookmark ; schema:url <${URL_}> ; dct:title "Fine" .
    `);
    expect(parseBookmark(RES, store)?.url).toBe(URL_);
  });

  it("parseBookmarkTtl also rejects a hostile non-http(s) url (filter applies through the parse path)", async () => {
    const ttl = `
      @prefix book:   <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <${SUBJ}> a book:Bookmark ; schema:url <javascript:alert(1)> .
    `;
    expect(await parseBookmarkTtl(RES, ttl, "text/turtle")).toBeUndefined();
  });

  it("parseBookmarkTtl dispatches via @jeswr/fetch-rdf (Turtle)", async () => {
    const ttl = await serializeBookmark(RES, { url: URL_, title: "Via fetch-rdf" });
    const back = await parseBookmarkTtl(RES, ttl, "text/turtle");
    expect(back?.title).toBe("Via fetch-rdf");
    expect(back?.url).toBe(URL_);
  });

  it("parseBookmarkTtl coalesces a null content-type to text/turtle", async () => {
    const ttl = await serializeBookmark(RES, { url: URL_, title: "Null CT" });
    const back = await parseBookmarkTtl(RES, ttl, null);
    expect(back?.title).toBe("Null CT");
  });
});

describe("Bookmark typed accessor", () => {
  it("the archived setter clears the triple on undefined and toggles true/false", () => {
    const store = new Store();
    const doc = new Bookmark(SUBJ, store, DataFactory).mark();
    doc.archived = true;
    expect(doc.archived).toBe(true);
    doc.archived = false;
    expect(doc.archived).toBe(false);
    expect(store.getQuads(SUBJ, BOOK_ARCHIVED, null, null)).toHaveLength(1);
    doc.archived = undefined;
    expect(store.getQuads(SUBJ, BOOK_ARCHIVED, null, null)).toHaveLength(0);
    // absent reads as false
    expect(doc.archived).toBe(false);
  });

  it("tags is a live set (add/delete reflected in the store)", () => {
    const store = new Store();
    const doc = new Bookmark(SUBJ, store, DataFactory).mark();
    doc.tags.add("a");
    doc.tags.add("b");
    expect([...doc.tags].sort()).toEqual(["a", "b"]);
    doc.tags.delete("a");
    expect([...doc.tags]).toEqual(["b"]);
  });
});

describe("isHttpIri (re-exported untrusted-input filter)", () => {
  it("accepts canonical http(s), rejects everything else (see iri.test.ts for the full contract)", () => {
    expect(isHttpIri("https://x.org/a")).toBe(true);
    expect(isHttpIri("http://x.org/")).toBe(true);
    expect(isHttpIri("javascript:alert(1)")).toBe(false);
    expect(isHttpIri("urn:uuid:1")).toBe(false);
    expect(isHttpIri(undefined)).toBe(false);
    expect(isHttpIri("")).toBe(false);
  });
});
