// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import type { MemoryData } from "./memory.js";
import { searchMemories } from "./search.js";

const AGENT_A = "https://agent-a.pod/profile/card#me";
const AGENT_B = "https://agent-b.pod/profile/card#me";
const ROOM_1 = "https://alice.pod/chat/room1#it";
const ROOM_2 = "https://alice.pod/chat/room2#it";

const items: MemoryData[] = [
  {
    text: "Alice prefers DARK mode",
    keywords: ["preference", "ui"],
    categories: ["https://cat/personal"],
    attributedTo: AGENT_A,
    generatedBy: ROOM_1,
    created: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    text: "Bob lives in Sydney",
    keywords: ["location"],
    categories: ["https://cat/personal", "https://cat/geo"],
    attributedTo: AGENT_B,
    generatedBy: ROOM_2,
    created: new Date("2026-06-10T00:00:00.000Z"),
  },
  {
    text: "Project deadline is July",
    keywords: ["work", "deadline"],
    attributedTo: AGENT_A,
    // No created — only modified (tests the fallback).
    modified: new Date("2026-06-15T00:00:00.000Z"),
  },
];

const texts = (out: MemoryData[]) => out.map((m) => m.text);

describe("text filter", () => {
  it("is a case-insensitive substring over text", () => {
    expect(texts(searchMemories(items, { text: "dark" }))).toEqual(["Alice prefers DARK mode"]);
    expect(texts(searchMemories(items, { text: "SYDNEY" }))).toEqual(["Bob lives in Sydney"]);
  });
});

describe("keywords filter (match-ALL)", () => {
  it("requires every given tag to be present", () => {
    expect(texts(searchMemories(items, { keywords: ["preference"] }))).toEqual([
      "Alice prefers DARK mode",
    ]);
    expect(texts(searchMemories(items, { keywords: ["preference", "ui"] }))).toEqual([
      "Alice prefers DARK mode",
    ]);
    // A tag the matching item lacks excludes it (match-ALL, not match-ANY).
    expect(texts(searchMemories(items, { keywords: ["preference", "location"] }))).toEqual([]);
  });
});

describe("categories filter (match-ALL, IRI)", () => {
  it("matches by category IRI, all required", () => {
    expect(texts(searchMemories(items, { categories: ["https://cat/personal"] }))).toEqual([
      "Alice prefers DARK mode",
      "Bob lives in Sydney",
    ]);
    expect(texts(searchMemories(items, { categories: ["https://cat/geo"] }))).toEqual([
      "Bob lives in Sydney",
    ]);
    expect(
      texts(searchMemories(items, { categories: ["https://cat/personal", "https://cat/geo"] })),
    ).toEqual(["Bob lives in Sydney"]);
  });
});

describe("agent + conversation filters (exact)", () => {
  it("filters by attributedTo (agent WebID exact)", () => {
    expect(texts(searchMemories(items, { attributedTo: AGENT_A }))).toEqual([
      "Alice prefers DARK mode",
      "Project deadline is July",
    ]);
  });
  it("filters by generatedBy (conversation IRI exact)", () => {
    expect(texts(searchMemories(items, { generatedBy: ROOM_2 }))).toEqual(["Bob lives in Sydney"]);
  });
});

describe("since/until time window (created, fallback modified)", () => {
  it("applies a since bound inclusive", () => {
    expect(texts(searchMemories(items, { since: new Date("2026-06-05T00:00:00.000Z") }))).toEqual([
      "Bob lives in Sydney",
      "Project deadline is July",
    ]);
  });
  it("applies an until bound inclusive", () => {
    expect(texts(searchMemories(items, { until: new Date("2026-06-10T00:00:00.000Z") }))).toEqual([
      "Alice prefers DARK mode",
      "Bob lives in Sydney",
    ]);
  });
  it("falls back to modified when created is absent", () => {
    // The deadline item has only modified=2026-06-15.
    expect(
      texts(
        searchMemories(items, {
          since: new Date("2026-06-12T00:00:00.000Z"),
          until: new Date("2026-06-20T00:00:00.000Z"),
        }),
      ),
    ).toEqual(["Project deadline is July"]);
  });
  it("excludes an item with no timestamp from a time-window query", () => {
    const noTs: MemoryData[] = [{ text: "timeless" }];
    expect(searchMemories(noTs, { since: new Date("2020-01-01") })).toEqual([]);
    expect(searchMemories(noTs, { until: new Date("2030-01-01") })).toEqual([]);
  });
});

describe("soft-forget (prov:invalidatedAtTime) filtering", () => {
  const live: MemoryData = { text: "live memory", created: new Date("2026-06-01T00:00:00.000Z") };
  const forgotten: MemoryData = {
    text: "forgotten memory",
    created: new Date("2026-06-01T00:00:00.000Z"),
    invalidatedAt: new Date("2026-06-02T00:00:00.000Z"),
  };
  const set = [live, forgotten];

  it("excludes a tombstoned memory by default", () => {
    expect(texts(searchMemories(set, {}))).toEqual(["live memory"]);
    // The forgotten one is excluded even when it would otherwise match a filter.
    expect(texts(searchMemories(set, { text: "memory" }))).toEqual(["live memory"]);
  });

  it("surfaces tombstoned memories with includeForgotten: true", () => {
    expect(texts(searchMemories(set, { includeForgotten: true }))).toEqual([
      "live memory",
      "forgotten memory",
    ]);
  });

  it("still applies the other filters when includeForgotten is true", () => {
    // includeForgotten lifts the tombstone exclusion but does NOT bypass other filters.
    expect(texts(searchMemories(set, { includeForgotten: true, text: "forgotten" }))).toEqual([
      "forgotten memory",
    ]);
    // A since bound after both created times excludes both even when forgotten is included.
    expect(
      texts(
        searchMemories(set, {
          includeForgotten: true,
          since: new Date("2026-06-01T12:00:00.000Z"),
        }),
      ),
    ).toEqual([]);
  });
});

describe("combined AND + empty query", () => {
  it("ANDs every provided filter", () => {
    expect(
      texts(
        searchMemories(items, {
          attributedTo: AGENT_A,
          keywords: ["work"],
        }),
      ),
    ).toEqual(["Project deadline is July"]);
    // Same agent, but a text that only the other matching item has → empty.
    expect(searchMemories(items, { attributedTo: AGENT_A, text: "sydney" })).toEqual([]);
  });

  it("returns all items for an empty query (and does not mutate input)", () => {
    const out = searchMemories(items, {});
    expect(out).toHaveLength(items.length);
    expect(out).not.toBe(items);
  });
});
