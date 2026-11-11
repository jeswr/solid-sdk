// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  ENTRY_CLASS,
  type EntryData,
  entryEntity,
  serializeEntry,
  validateEntry,
} from "../src/model.js";

const url = "https://pod.example/entry.ttl";
const data: EntryData = { created: new Date("2026-11-11T12:00:00Z"), text: "A quiet afternoon." };

describe("journal write validation", () => {
  it("keeps a friendly validation error instead of silently dropping an invalid mood", () => {
    expect(() => validateEntry({ ...data, mood: "unknown" as "good" })).toThrow(
      "Choose a mood from the list",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AA==",
    "file:///photo.png",
    "ftp://pod.example/photo.png",
    "photo.png",
    "",
    "https://",
    "https://pod.example/photo|.png",
  ])("reports an invalid image link (%j) alone or alongside a valid photo", async (image) => {
    for (const images of [[image], ["https://pod.example/photo.png", image]]) {
      const invalid = { ...data, images };
      expect(() => validateEntry(invalid)).toThrow("Use a valid HTTP(S) link for every photo");
      await expect(serializeEntry(url, invalid)).rejects.toThrow(
        "Use a valid HTTP(S) link for every photo",
      );
    }
  });

  it("uses generated normalisation and deduplication without rejecting valid image links", () => {
    expect(
      validateEntry({
        ...data,
        images: [" https://POD.EXAMPLE ", "https://pod.example/", "http://pod.example/photo.png"],
      }).images,
    ).toEqual(["https://pod.example/", "http://pod.example/photo.png"]);
    expect(validateEntry({ ...data, images: [] }).images).toBeUndefined();
    expect(validateEntry(data).images).toBeUndefined();
  });
});

describe("journal standard type interoperability", () => {
  it("writes journal:Entry and schema:CreativeWork explicitly and round-trips the data", async () => {
    const storage = createMemoryStorage({ root: "https://pod.example/", protocol: "solid" });
    const body = await serializeEntry(url, data);
    await storage.create(storage.root, body, { name: "entry.ttl", contentType: "text/turtle" });
    const { dataset } = await storage.readRdf(url);
    const entry = new entryEntity.Wrapper(entryEntity.subject(url), dataset, DataFactory);
    expect(new Set(entry.types)).toEqual(new Set([ENTRY_CLASS, "http://schema.org/CreativeWork"]));
    expect(entryEntity.parse(url, dataset)).toEqual(validateEntry(data));
  });

  it("continues reading entries with only journal:Entry and adds the standard type when saved", async () => {
    const legacy = entryEntity.build(url, data);
    const entry = new entryEntity.Wrapper(entryEntity.subject(url), legacy, DataFactory);
    expect([...entry.types]).toEqual([ENTRY_CLASS]);
    const parsed = await entryEntity.parseDocument(url, await entryEntity.storeToTurtle(legacy));
    expect(parsed).toEqual(validateEntry(data));
    if (!parsed) throw new Error("The legacy entry should be readable");
    const storage = createMemoryStorage({ root: "https://pod.example/", protocol: "solid" });
    await storage.create(storage.root, await serializeEntry(url, parsed), {
      name: "entry.ttl",
      contentType: "text/turtle",
    });
    const { dataset } = await storage.readRdf(url);
    const saved = new entryEntity.Wrapper(entryEntity.subject(url), dataset, DataFactory);
    expect(saved.types.has(ENTRY_CLASS)).toBe(true);
    expect(saved.types.has("http://schema.org/CreativeWork")).toBe(true);
    expect([...entry.types]).toEqual([ENTRY_CLASS]);
  });
});
