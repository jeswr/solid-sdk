// AUTHORED-BY Claude Sonnet 5.5
import type { Literal } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ReferenceStore } from "../src/rdf.js";

const subject = df.namedNode("https://example.org/s");
const predicate = df.namedNode("https://example.org/p");
function lang(value: string, language: string): Literal {
  const literal = df.literal(value, language);
  Object.defineProperty(literal, "language", { value: language });
  Object.defineProperty(literal, "id", { value: `"${value}"@${language}` });
  return literal;
}

describe("language-tag de-duplication work", () => {
  it("never rescans stored objects, however many tagged literals share a subject and predicate", () => {
    const scans = vi.spyOn(Store.prototype, "getQuads");
    const matches = vi.spyOn(Store.prototype, "match");
    try {
      const store = new ReferenceStore();
      for (let i = 0; i < 3000; i++)
        store.addQuad(subject, predicate, lang(`value ${i}`, i % 2 ? "en" : "EN"));
      expect(store.size).toBe(3000);
      expect(scans).not.toHaveBeenCalled();
      expect(matches).not.toHaveBeenCalled();
    } finally {
      scans.mockRestore();
      matches.mockRestore();
    }
  });

  it("keeps the first spelling and still separates graph, subject, predicate, value and tag", () => {
    const other = df.namedNode("https://example.org/other");
    const g = df.namedNode("https://example.org/g");
    const store = new ReferenceStore();
    expect(store.addQuad(subject, predicate, lang("a", "en-US"), g)).toBe(true);
    expect(store.addQuad(subject, predicate, lang("a", "EN-us"), g)).toBe(false);
    expect(store.addQuad(subject, predicate, lang("a", "en-US"), g)).toBe(false);
    expect(store.addQuad(subject, predicate, lang("a", "en-US"))).toBe(true);
    expect(store.addQuad(other, predicate, lang("a", "en-US"), g)).toBe(true);
    expect(store.addQuad(subject, other, lang("a", "en-US"), g)).toBe(true);
    expect(store.addQuad(subject, predicate, lang("b", "en-US"), g)).toBe(true);
    expect(store.addQuad(subject, predicate, lang("a", "fr"), g)).toBe(true);
    expect(store.addQuad(subject, predicate, df.literal("a"), g)).toBe(true);
    expect(store.size).toBe(7);
    const tags = store
      .getQuads(subject, predicate, null, g)
      .map((q) => (q.object as Literal).language);
    expect(tags).toContain("en-US");
    expect(tags).not.toContain("EN-us");
  });

  it("forgets a literal when its quad is removed, by quad or by terms", () => {
    const store = new ReferenceStore();
    const quad = df.quad(subject, predicate, lang("a", "en"));
    expect(store.addQuad(quad)).toBe(true);
    // A different spelling is a different stored term: nothing is removed.
    expect(store.removeQuad(df.quad(subject, predicate, lang("a", "EN")))).toBe(false);
    expect(store.addQuad(subject, predicate, lang("a", "EN"))).toBe(false);
    expect(store.removeQuad(quad)).toBe(true);
    expect(store.addQuad(subject, predicate, lang("a", "EN"))).toBe(true);
    expect(store.removeQuad(subject, predicate, lang("a", "EN"))).toBe(true);
    expect(store.removeQuad(subject, predicate, df.literal("plain"))).toBe(false);
    expect(store.addQuad(subject, predicate, lang("a", "en"))).toBe(true);
    expect(store.size).toBe(1);
  });
});
