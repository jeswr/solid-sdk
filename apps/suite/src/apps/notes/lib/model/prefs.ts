// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";

export const NoteColour = z.enum([
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "grey",
]);
export type NoteColour = z.infer<typeof NoteColour>;
export const notesPreferencesSchema = z.object({
  pinned: z.array(z.string()).default([]),
  view: z.enum(["grid", "list"]).default("grid"),
  colours: z.record(z.string(), NoteColour).default({}),
});
export type NotesPreferences = z.infer<typeof notesPreferencesSchema>;

export function togglePinned(prefs: NotesPreferences, url: string): NotesPreferences {
  return {
    ...prefs,
    pinned: prefs.pinned.includes(url)
      ? prefs.pinned.filter((item) => item !== url)
      : [...prefs.pinned, url],
  };
}

export function prunePreferences(
  prefs: NotesPreferences,
  existingUrls: Iterable<string>,
): NotesPreferences {
  const existing = new Set(existingUrls);
  return {
    ...prefs,
    pinned: prefs.pinned.filter((url) => existing.has(url)),
    colours: Object.fromEntries(Object.entries(prefs.colours).filter(([url]) => existing.has(url))),
  };
}

export function rekeyPreferences(
  prefs: NotesPreferences,
  from: string,
  to: string,
): NotesPreferences {
  const colours = { ...prefs.colours };
  if (Object.hasOwn(colours, from)) {
    const colour = colours[from] as NoteColour;
    delete colours[from];
    Object.defineProperty(colours, to, {
      value: colour,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    ...prefs,
    pinned: [...new Set(prefs.pinned.map((url) => (url === from ? to : url)))],
    colours,
  };
}
