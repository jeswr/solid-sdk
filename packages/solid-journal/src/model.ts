// AUTHORED-BY Codex (GPT-6.1 Sol)
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
  if (data.mood !== undefined && !MOODS.includes(data.mood))
    throw new TypeError("Choose a mood from the list");
  const parsed = entryEntity.parse(url, entryEntity.build(url, data));
  if (!parsed) throw new TypeError("Write some words and choose a valid date");
  return parsed;
}

export async function serializeEntry(url: string, data: EntryData): Promise<string> {
  return entryEntity.serialize(url, validateEntry(data));
}
