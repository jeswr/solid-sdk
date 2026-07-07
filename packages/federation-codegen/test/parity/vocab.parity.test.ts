// AUTHORED-BY Claude Opus 4.8
// PARITY: @jeswr/solid-bookmark's src/vocab.test.ts, VERBATIM except the vocab
// constants are imported from the facade (which derives them from the generated
// manifest — the verified projection) rather than the hand-written vocab module.
import { describe, expect, it } from "vitest";
import {
  BOOK,
  BOOK_ARCHIVED,
  BOOK_NOTES,
  BOOKMARK_CLASS,
  book,
  CORE,
  DCT_CREATED,
  DCT_DESCRIPTION,
  DCT_MODIFIED,
  DCT_TITLE,
  PREFIXES,
  RDF_TYPE,
  SCHEMA,
  SCHEMA_KEYWORDS,
  SCHEMA_URL,
} from "../../examples/bookmark/facade.js";

describe("vocab IRIs", () => {
  it("the namespace is the w3id bookmark home", () => {
    expect(BOOK).toBe("https://w3id.org/jeswr/bookmark#");
    expect(CORE).toBe("https://w3id.org/jeswr/core#");
  });

  it("schema.org uses the canonical http scheme (matching the suite producers)", () => {
    expect(SCHEMA).toBe("http://schema.org/");
  });

  it("mints EXACTLY the three book: terms (Bookmark, archived, notes)", () => {
    expect(BOOKMARK_CLASS).toBe("https://w3id.org/jeswr/bookmark#Bookmark");
    expect(BOOK_ARCHIVED).toBe("https://w3id.org/jeswr/bookmark#archived");
    expect(BOOK_NOTES).toBe("https://w3id.org/jeswr/bookmark#notes");
  });

  it("reuses schema.org / Dublin Core for the rest (nothing minted)", () => {
    expect(SCHEMA_URL).toBe("http://schema.org/url");
    expect(SCHEMA_KEYWORDS).toBe("http://schema.org/keywords");
    expect(DCT_TITLE).toBe("http://purl.org/dc/terms/title");
    expect(DCT_DESCRIPTION).toBe("http://purl.org/dc/terms/description");
    expect(DCT_CREATED).toBe("http://purl.org/dc/terms/created");
    expect(DCT_MODIFIED).toBe("http://purl.org/dc/terms/modified");
    expect(RDF_TYPE).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  });

  it("the term builders concatenate onto the right namespace", () => {
    expect(book("Bookmark")).toBe(BOOKMARK_CLASS);
    expect(book("archived")).toBe(BOOK_ARCHIVED);
  });

  it("the PREFIXES map round-trips every namespace it declares", () => {
    expect(PREFIXES.book).toBe(BOOK);
    expect(PREFIXES.schema).toBe(SCHEMA);
    expect(PREFIXES.dct).toBe("http://purl.org/dc/terms/");
    for (const ns of Object.values(PREFIXES)) {
      expect(ns).toMatch(/^https?:\/\/.+[#/]$/);
    }
  });
});
