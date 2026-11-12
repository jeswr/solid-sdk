// AUTHORED-BY Codex GPT-6.1-Sol
import sanitizeHtml from "sanitize-html";
import { firstNoteImage } from "./images";
import type { Note } from "./model/note";
import { NoteColour, type NotesPreferences } from "./model/prefs";
import { hasNoteReminder, selectNotes } from "./model/query";
import { noteText } from "./model/text";
import { checklistItems } from "./ui/checklist";

export const noteSearchTypes = ["images", "lists", "reminders", "links"] as const;
export type NoteSearchType = (typeof noteSearchTypes)[number];
export interface NoteSearchFilters {
  q: string;
  type?: NoteSearchType | undefined;
  colour?: NoteColour | undefined;
  label?: string | undefined;
  shared?: string | undefined;
}
export interface NoteSearchContext {
  prefs: NotesPreferences;
  podRoot: string;
  sharedNotes: Readonly<Record<string, boolean>>;
  collaborators: Readonly<Record<string, readonly string[]>>;
}

function httpUrl(value: string): boolean {
  if (/[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Unknown and invalid URL fields are inert. Labels and WebIDs retain exact identity. */
export function parseNoteSearch(input: string | Pick<URLSearchParams, "get">): NoteSearchFilters {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const filters: NoteSearchFilters = { q: (params.get("q") ?? "").trim() };
  const type = params.get("type");
  if (noteSearchTypes.includes(type as NoteSearchType)) filters.type = type as NoteSearchType;
  const colour = NoteColour.safeParse(params.get("colour"));
  if (colour.success) filters.colour = colour.data;
  const label = params.get("label");
  if (label?.trim() && !/[\p{Cc}\p{Cs}]/u.test(label)) filters.label = label;
  const shared = params.get("shared");
  if (shared && (shared === "any" || httpUrl(shared))) filters.shared = shared;
  return filters;
}

export function serializeNoteSearch(filters: NoteSearchFilters): string {
  const params = new URLSearchParams();
  for (const key of ["q", "type", "colour", "label", "shared"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function noteSearchHref(filters: NoteSearchFilters): string {
  const query = serializeNoteSearch(filters);
  return `/notes/search${query ? `?${query}` : ""}`;
}

function hasLink(note: Note): boolean {
  let linked = false;
  sanitizeHtml(note.body, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag: (tag, attrs) => {
      if (tag === "a" && httpUrl(attrs.href ?? "")) linked = true;
    },
  });
  return linked || /\bhttps?:\/\/[^\s<>"']+/iu.test(`${note.title}\n${noteText(note.body)}`);
}

/** All facets and the existing ranked text/label search compose with AND. No input is mutated. */
export function matchesNoteSearch(
  note: Note,
  filters: NoteSearchFilters,
  context: NoteSearchContext,
): boolean {
  if (note.location === "trashed") return false;
  if (filters.type) {
    const matches = {
      images: () => !!firstNoteImage(note.body, context.podRoot),
      lists: () => checklistItems(note.body).length > 0,
      reminders: () => hasNoteReminder(note),
      links: () => hasLink(note),
    };
    if (!matches[filters.type]()) return false;
  }
  if (filters.colour && (context.prefs.colours[note.url] ?? "default") !== filters.colour)
    return false;
  if (
    filters.shared &&
    !(filters.shared === "any"
      ? context.sharedNotes[note.url] === true
      : context.collaborators[note.url]?.includes(filters.shared))
  )
    return false;
  if (!filters.q.trim() && filters.label === undefined) return true;
  const selected = selectNotes([note], context.prefs, {
    location: note.location,
    query: filters.q,
    ...(filters.label === undefined ? {} : { labels: [filters.label] }),
  });
  return selected.pinned.length + selected.others.length > 0;
}
