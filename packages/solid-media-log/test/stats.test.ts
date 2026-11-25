// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import type { MediaEntry } from "../src/model.js";
import { mediaStats } from "../src/stats.js";

it("counts dated completions per month and kind, with explicit rated denominators", () => {
  const entries: MediaEntry[] = [
    {
      title: "Film",
      kind: "film",
      status: "finished",
      finished: "2026-01-01",
      rating: 4,
      repeatCount: 3,
    },
    { title: "Book", kind: "book", status: "finished", finished: "2026-01-03", rating: 5 },
    { title: "Episode", kind: "episode", status: "finished", finished: "2026-02-01" },
    { title: "TV", kind: "tv", status: "finished", finished: "2026-02-02", rating: 5 },
    { title: "Game", kind: "game", status: "finished", finished: "2026-12-01" },
    { title: "No date", kind: "book", status: "finished" },
    { title: "Old", kind: "film", status: "finished", finished: "2025-01-01" },
    { title: "Not finished", kind: "film", status: "in-progress", finished: "2026-01-01" },
    { title: "Bad date", kind: "film", status: "finished", finished: "2026-02-30" },
  ];
  const stats = mediaStats(entries, 2026);
  expect(stats.total).toBe(5);
  expect(stats.rated).toBe(3);
  expect(stats.average).toBeCloseTo(14 / 3);
  expect(stats.months[0]).toEqual({ month: 0, film: 1, book: 1, tv: 0, game: 0 });
  expect(stats.months[1]?.tv).toBe(2);
  expect(stats.best?.title).toBe("Book");
});
it("returns empty monthly buckets and no average when no dated ratings exist", () => {
  expect(mediaStats([], 2026)).toMatchObject({
    total: 0,
    rated: 0,
    average: null,
    best: undefined,
  });
  expect(
    mediaStats(
      [{ title: "Unrated", kind: "book", status: "finished", finished: "2026-01-01" }],
      2026,
    ).average,
  ).toBeNull();
});
