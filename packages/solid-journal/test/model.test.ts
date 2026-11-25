// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  ENTRY_CLASS,
  type EntryData,
  entryEntity,
  MOODS,
  serializeEntry,
  validateEntry,
} from "../src/model.js";

const url = "https://pod.example/journal/a.ttl";
const data: EntryData = {
  created: new Date("2026-11-11T12:00:00Z"),
  text: "# A new page\n\n**Hello**, world.",
  title: "Wednesday",
  tags: [" days ", "days", ""],
  mood: "good",
  location: "Willowbridge",
  weather: "Cloudy",
  images: ["https://pod.example/journal/photo.png"],
};
describe("generated Entry model", () => {
  it("preserves all fields through generated RDF and parseDocument", async () => {
    expect(entryEntity.typeIri).toBe(ENTRY_CLASS);
    expect(entryEntity.subject(url)).toBe(`${url}#it`);
    const value = validateEntry(data);
    expect(value.tags).toEqual(["days"]);
    expect(
      await entryEntity.parseDocument(url, await serializeEntry(url, data), "text/turtle"),
    ).toEqual(value);
  });
  it.each(MOODS)("supports mood %s", (mood) =>
    expect(validateEntry({ ...data, mood }).mood).toBe(mood));
  it("requires nonblank text and a valid date and rejects invalid enum writes", () => {
    expect(() => validateEntry({ ...data, text: "  " })).toThrow();
    expect(() => validateEntry({ ...data, created: new Date("invalid") })).toThrow();
    expect(() => validateEntry({ ...data, mood: "unknown" as "good" })).toThrow();
    expect(validateEntry({ text: "one word", created: data.created }).mood).toBeUndefined();
    expect(() => entryEntity.subject("relative.ttl")).toThrow();
  });
  it("drops unsafe optional image IRIs on untrusted reads and fails closed on malformed MUSTs", () => {
    const store = entryEntity.build(url, { ...data, images: ["javascript:alert(1)"] });
    expect(entryEntity.parse(url, store)?.images ?? []).toEqual([]);
    expect(entryEntity.parse(url, entryEntity.build(url, { ...data, text: "" }))).toBeUndefined();
  });
});
