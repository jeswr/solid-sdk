// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  type GranaryAs2Object,
  isActivity,
  isCollection,
  iterateObjects,
  typeSet,
} from "../src/granary.js";
import { blueskyCreate, githubCollection, mastodonNote, messyFeed, rssFeed } from "./fixtures.js";

describe("typeSet", () => {
  it("handles string, array, and absent", () => {
    expect([...typeSet("Note")]).toEqual(["Note"]);
    expect([...typeSet(["Note", "Public"])]).toEqual(["Note", "Public"]);
    expect([...typeSet(undefined)]).toEqual([]);
    // non-string array members are filtered
    // biome-ignore lint/suspicious/noExplicitAny: untrusted type field.
    expect([...typeSet(["Note", 5 as any])]).toEqual(["Note"]);
  });
});

describe("isCollection", () => {
  it("is true for Collection / OrderedCollection", () => {
    expect(isCollection(rssFeed)).toBe(true);
    expect(isCollection(githubCollection)).toBe(true);
  });
  it("is true for a typeless wrapper carrying items/orderedItems", () => {
    expect(isCollection({ items: [] })).toBe(true);
    expect(isCollection({ orderedItems: [] })).toBe(true);
  });
  it("is false for a single object", () => {
    expect(isCollection(mastodonNote)).toBe(false);
  });
});

describe("isActivity", () => {
  it("is true for Create/Announce/... activities", () => {
    expect(isActivity(blueskyCreate)).toBe(true);
    expect(isActivity({ type: "Announce" })).toBe(true);
  });
  it("is false for a plain Note/Article", () => {
    expect(isActivity(mastodonNote)).toBe(false);
    expect(isActivity({ type: "Article" })).toBe(false);
  });
});

describe("iterateObjects", () => {
  it("yields a single object as one item", () => {
    const items = [...iterateObjects(mastodonNote)];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(mastodonNote.id);
  });

  it("flattens an OrderedCollection's items in order", () => {
    const items = [...iterateObjects(rssFeed)];
    expect(items.map((i) => i.id)).toEqual([
      "https://blog.example/posts/1",
      "https://blog.example/posts/2",
    ]);
  });

  it("flattens a plain Collection's items", () => {
    const items = [...iterateObjects(githubCollection)];
    expect(items).toHaveLength(1);
  });

  it("unwraps an Activity envelope to its wrapped object", () => {
    const items = [...iterateObjects(blueskyCreate)];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("https://bsky.app/profile/carol.bsky.social/post/3k");
    expect(items[0]?.type).toBe("Note");
  });

  it("skips junk entries in a collection", () => {
    const items = [...iterateObjects(messyFeed)];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("https://example.org/valid");
  });

  it("respects maxItems", () => {
    const big: GranaryAs2Object[] = Array.from({ length: 10 }, (_, n) => ({
      type: "Note",
      id: `https://x.example/${n}`,
      content: `m${n}`,
    }));
    const items = [...iterateObjects({ type: "Collection", items: big }, 3)];
    expect(items).toHaveLength(3);
  });

  it("maxItems also bounds the unwrapped objects of an activity", () => {
    const activity: GranaryAs2Object = {
      type: "Create",
      object: [
        { type: "Note", content: "a" },
        { type: "Note", content: "b" },
        { type: "Note", content: "c" },
      ],
    };
    expect([...iterateObjects(activity, 2)]).toHaveLength(2);
  });
});
