// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesError, rankNotes, type SearchableNote } from "../src/apps/notes/lib/organise";

function note(id: string, fields: Partial<SearchableNote> = {}) {
  return Object.freeze({
    id: `https://example.org/notes/${id}`,
    title: "",
    body: "",
    labels: Object.freeze([] as string[]),
    updatedAt: 0,
    ...fields,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("notes search ranking", () => {
  it("ranks phrase above prefix above tokens regardless of field, frequency, pin or recency", () => {
    const phrase = note("phrase", { body: "A red fox runs", updatedAt: -10 });
    const prefix = note("prefix", { labels: ["red foxtrot"], updatedAt: 5 });
    const token = Object.freeze({
      ...note("tokens", { title: "fox fox red red", updatedAt: 10 }),
      pinned: true,
    });
    const missing = note("missing", { title: "red", updatedAt: 100 });
    const input = Object.freeze([token, prefix, missing, phrase]);
    expect(rankNotes(input, "red fox")).toEqual([
      { note: phrase, match: "phrase", score: 3 },
      { note: prefix, match: "prefix", score: 2 },
      { note: token, match: "token", score: 1 },
    ]);
    expect(input).toEqual([token, prefix, missing, phrase]);
    expect(rankNotes(input, "red fox")[0]?.note).toBe(phrase);
  });

  it("breaks every relevance tier by recency then stable input order", () => {
    for (const title of ["red fox", "red foxtrot", "fox red"]) {
      const a = note("a", { title, updatedAt: -1 });
      const b = note("b", { title, updatedAt: 5 });
      const c = note("c", { title, updatedAt: 5 });
      const input = Object.freeze([a, b, c]);
      expect(rankNotes(input, "red fox").map((hit) => hit.note)).toEqual([b, c, a]);
      expect(input).toEqual([a, b, c]);
    }
  });

  it.each(["title", "body", "labels"] as const)("searches %s with equal relevance", (field) => {
    const phrase = note("phrase", { [field]: field === "labels" ? ["red fox"] : "red fox" });
    const prefix = note("prefix", {
      [field]: field === "labels" ? ["red foxtrot"] : "red foxtrot",
    });
    expect(rankNotes([prefix, phrase], "red fox").map((hit) => hit.match)).toEqual([
      "phrase",
      "prefix",
    ]);
  });

  it("does not invent phrases across fields or between distinct labels", () => {
    const a = note("title-body", { title: "red", body: "fox" });
    const b = note("title-label", { title: "red", labels: ["fox"] });
    const c = note("two-labels", { labels: ["red", "fox"] });
    expect(rankNotes([a, b, c], "red fox").map((hit) => hit.match)).toEqual([
      "token",
      "token",
      "token",
    ]);
    expect(rankNotes([a, b, c], "red fo")).toEqual([]);
  });

  it("requires whole words, all query tokens, and only prefixes the final word", () => {
    const notes = [
      note("suffix", { title: "tired fox" }),
      note("first-prefix", { title: "reddish fox" }),
      note("incomplete", { title: "red" }),
      note("wrong-order-prefix", { title: "foxtrot red" }),
    ];
    expect(rankNotes(notes, "red fox")).toEqual([]);
    expect(rankNotes([note("later", { title: "unrelated red fox" })], "red fox")[0]?.match).toBe(
      "phrase",
    );
    expect(
      rankNotes([note("later-prefix", { title: "unrelated red foxes" })], "red fox")[0]?.match,
    ).toBe("prefix");
    expect(rankNotes([note("long", { title: "red fox" })], "red fox runs")).toEqual([]);
    expect(rankNotes([note("duplicate", { title: "red" })], "red red")[0]?.match).toBe("token");
  });

  it("shares Unicode word segmentation and folding with the suite search index", () => {
    const a = note("unicode", { title: "CAFÉ — STRAẞE", body: "Σίσυφος", labels: ["中文笔记"] });
    expect(rankNotes([a], "cafe\u0301 strasse")[0]?.match).toBe("phrase");
    expect(rankNotes([a], "σιΣΥΦΟΣ")[0]?.match).toBe("phrase");
    expect(rankNotes([a], "中文笔记")[0]?.match).toBe("phrase");
    expect(rankNotes([note("spaces", { title: "Red\n\tfox" })], "  RED   FOX  ")[0]?.match).toBe(
      "phrase",
    );
  });

  it("handles empty collections, empty fields, misses and wordless queries", () => {
    expect(rankNotes([], "red fox")).toEqual([]);
    expect(rankNotes([note("empty")], "red")).toEqual([]);
    for (const query of ["", " \n\t", "👩🏽‍💻 !!!"]) {
      expect(rankNotes([note("present", { title: "Title" })], query)).toEqual([]);
    }
    expect(rankNotes([note("prefix", { title: "foxtrot" })], "fox")[0]?.match).toBe("prefix");
  });

  it("rejects malformed inputs even on empty queries or collections", () => {
    const fails = (operation: () => unknown) => {
      expect(operation).toThrow(NotesError);
      expect(operation).toThrow(expect.objectContaining({ code: "invalid-input" }));
    };
    for (const query of [null, 3, "\ud800"]) fails(() => rankNotes([], query as string));
    fails(() => rankNotes(null as unknown as SearchableNote[], ""));
    for (const invalid of [null, 3, {}, new Array(1)[0]]) {
      fails(() => rankNotes([invalid as SearchableNote], ""));
    }
    for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "today"]) {
      fails(() => rankNotes([note("bad-date", { updatedAt: invalid as number })], ""));
    }
    for (const field of ["title", "body"] as const) {
      for (const invalid of [null, 3, "\ud800"]) {
        fails(() => rankNotes([note("bad-text", { [field]: invalid })], ""));
      }
    }
    for (const invalid of [null, [""], [3], ["\ud800"], new Array(1)]) {
      fails(() => rankNotes([note("bad-labels", { labels: invalid as string[] })], ""));
    }
    fails(() => rankNotes(new Array(1), ""));
    fails(() =>
      rankNotes([note("match", { title: "red" }), note("invalid", { title: "\ud800" })], "red"),
    );
  });

  it("fails closed when Unicode word segmentation is unavailable", () => {
    vi.spyOn(Intl, "Segmenter", "get").mockReturnValue(
      undefined as unknown as typeof Intl.Segmenter,
    );
    expect(() => rankNotes([], "red")).toThrow(
      expect.objectContaining({ code: "segmenter-unavailable" }),
    );
  });
});
