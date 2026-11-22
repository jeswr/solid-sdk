// AUTHORED-BY Codex (GPT-6.1 Sol)
import { DataFactory } from "n3";
import { type EntryData, entities } from "./generated/model.js";

export type { EntryData } from "./generated/model.js";
export type Mood = NonNullable<EntryData["mood"]>;
export const MOODS = [
  "awful",
  "bad",
  "okay",
  "good",
  "great",
] as const satisfies readonly NonNullable<EntryData["mood"]>[];
export const ENTRY_CLASS = "https://jeswr.org/ns/journal#Entry";
export const entryEntity = entities.Entry;

/** The generated writer drops invalid fields; refuse an invalid required record before I/O. */
export function validateEntry(data: EntryData): EntryData {
  const url = "https://journal.example/validation.ttl";
  // Give a friendly error instead of the generated optional-enum writer's silent drop.
  if (data.mood !== undefined && !MOODS.includes(data.mood))
    throw new TypeError("Choose a mood from the list");
  const store = entryEntity.build(url, data);
  const images = new entryEntity.Wrapper(entryEntity.subject(url), store, DataFactory).images;
  if (data.images?.some((image) => !images.has(image)))
    throw new TypeError("Use a valid HTTP(S) link for every photo");
  const parsed = entryEntity.parse(url, store);
  if (!parsed) throw new TypeError("Write some words and choose a valid date");
  return parsed;
}

export async function serializeEntry(url: string, data: EntryData): Promise<string> {
  const store = entryEntity.build(url, validateEntry(data));
  // Codegen emits one canonical type; add the standard superclass through its typed accessor.
  new entryEntity.Wrapper(entryEntity.subject(url), store, DataFactory).types.add(
    "http://schema.org/CreativeWork",
  );
  return entryEntity.storeToTurtle(store);
}
