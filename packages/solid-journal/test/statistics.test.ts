// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import {
  calculateStreak,
  dayKey,
  daysWritten,
  excerpt,
  exportMarkdown,
  markdownToPlainText,
  onThisDay,
  wordCount,
} from "../src/statistics.js";

const entry = (date: string) => ({ created: new Date(date), text: "Some **lovely** words." });
it("counts distinct calendar days and streaks ending today or yesterday", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  expect(calculateStreak([], now)).toEqual({ current: 0, longest: 0 });
  const entries = [
    entry("2026-11-09"),
    entry("2026-11-10"),
    entry("2026-11-10"),
    entry("2026-11-11"),
    entry("2026-11-13"),
  ];
  expect(calculateStreak(entries, now)).toEqual({ current: 3, longest: 3 });
  expect(calculateStreak(entries.slice(0, 3), now)).toEqual({ current: 2, longest: 2 });
  expect(calculateStreak(entries.slice(0, 1), now)).toEqual({ current: 0, longest: 1 });
  expect(daysWritten(entries).get("2026-11-10")).toBe(2);
  expect(dayKey(new Date("2026-03-29T00:30:00Z"), "Europe/London")).toBe("2026-03-29");
  expect(dayKey(new Date("2026-11-11T00:30:00Z"), "America/New_York")).toBe("2026-11-10");
  expect(() => dayKey(new Date("invalid"))).toThrow();
});
it("finds only previous years, handles leap day exactly and doesn't reorder input", () => {
  const entries = [
    entry("2024-02-29"),
    entry("2028-02-29"),
    entry("2020-02-29"),
    entry("2025-02-28"),
  ];
  expect(onThisDay(entries, new Date("2028-02-29"))).toEqual([entries[0], entries[2]]);
  expect(onThisDay(entries, new Date("2026-02-28"))).toEqual([entries[3]]);
  expect(entries[0]?.created.getFullYear()).toBe(2024);
});
it("removes Markdown formatting without rendering active HTML; counts words and Unicode excerpts", () => {
  expect(
    markdownToPlainText(
      "# Heading\n\n**bold** _soft_ ~~gone~~ `code`\n> quote\n- [x] done\n1. item\n[link](https://example.org) ![photo](photo.png)\n<script>bad()</script>",
    ),
  ).toBe("Heading bold soft gone code quote done item link photo");
  expect(
    markdownToPlainText(
      "~~~js\nlet value = 1\n~~~\n<style>bad</style>\n---\n[ref][id]\n[id]: https://example.org\n\\# escaped &amp; &nbsp;",
    ),
  ).toContain("let value = 1 ref # escaped &");
  expect(wordCount("It's a well-loved café. 42!")).toBe(5);
  expect(wordCount("   ")).toBe(0);
  expect(excerpt("**hello**", 10)).toBe("hello");
  expect(excerpt("🌱hello", 2)).toBe("🌱h…");
  expect(excerpt("hello there", 6)).toBe("hello…");
  expect(() => excerpt("text", 0)).toThrow();
  expect(() => excerpt("text", 1.5)).toThrow();
});
it("exports all entries in date order with Markdown, metadata and photos intact", () => {
  const first = {
    ...entry("2025-11-11"),
    title: "First",
    mood: "great" as const,
    tags: ["a", "b"],
    location: "Willowbridge",
    weather: "Cloudy",
    images: ["https://pod.example/a.png"],
  };
  const output = exportMarkdown([entry("2026-11-11"), first]);
  expect(output.indexOf("# First")).toBeLessThan(output.indexOf("# Untitled entry"));
  for (const value of [
    "Mood: great",
    "Tags: a, b",
    "Location: Willowbridge",
    "Weather: Cloudy",
    "**lovely**",
    "![Attached photo](<https://pod.example/a.png>)",
  ])
    expect(output).toContain(value);
  expect(exportMarkdown([])).toBe("");
});
