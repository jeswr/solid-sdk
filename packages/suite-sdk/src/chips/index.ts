// AUTHORED-BY Codex GPT-6.1-Sol
import {
  mentionNotification as mentionDraft,
  type NotificationDraft,
} from "@jeswr/pod-access/notify";
import type { Search } from "../search/types.js";

export { createMentionNotifier } from "./mentions.js";
export { type ResolvedChip, resolveChip } from "./resolve.js";

export const chipKinds = [
  "person",
  "file",
  "doc",
  "sheet",
  "note",
  "event",
  "task",
  "place",
  "link",
] as const;
export type ChipKind = (typeof chipKinds)[number];
export interface ChipRef {
  iri: string;
  kind: ChipKind;
  label: string;
  app?: string;
}

/** Only absolute, credential-free HTTP(S) identifiers may become interactive chips. */
export function chipIri(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !/\s/.test(value);
  } catch {
    return false;
  }
}

/** Classify common suite and interoperable vocabulary types without creating another index. */
export function chipKind(type = ""): ChipKind {
  const local = (type.split(/[/#]/).pop() as string).toLowerCase();
  if (["person", "individual", "agent"].includes(local)) return "person";
  if (["document", "digitaldocument", "doc"].includes(local)) return "doc";
  if (["spreadsheet", "sheet"].includes(local)) return "sheet";
  if (["note", "textdigitaldocument"].includes(local)) return "note";
  if (["event", "vevent"].includes(local)) return "event";
  if (["task", "todo", "issue"].includes(local)) return "task";
  if (["place", "location"].includes(local)) return "place";
  return local === "link" ? "link" : "file";
}

/** Contacts can include the user's known WebIDs; search remains the sole resource resolver. */
export async function chipCandidates(
  query: string,
  options: {
    search: Search;
    contacts: readonly ChipRef[];
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ChipRef[]> {
  const limit = options.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("Invalid chip limit");
  const needle = query.trim().toLowerCase();
  const page = await options.search(
    { text: query.trim(), limit: Math.max(50, limit) },
    { signal: options.signal },
  );
  options.signal?.throwIfAborted();
  const all = [
    ...options.contacts,
    ...page.results.map(
      (result): ChipRef => ({
        iri: result.url,
        label: result.title,
        kind: chipKind(result.type),
      }),
    ),
  ];
  const unique = new Map<string, ChipRef>();
  for (const ref of all) {
    if (!chipIri(ref.iri) || unique.has(ref.iri)) continue;
    if (needle && !`${ref.label} ${ref.iri}`.toLowerCase().includes(needle)) continue;
    unique.set(ref.iri, ref);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(needle)) -
          Number(!b.label.toLowerCase().startsWith(needle)) ||
        a.label.localeCompare(b.label) ||
        a.iri.localeCompare(b.iri),
    )
    .slice(0, limit);
}

/** A Create activity built by the shared notification helper; this never grants access. */
export function mentionNotification(
  resource: string,
  mentionedWebId: string,
  excerpt: string,
): NotificationDraft {
  if (!chipIri(resource) || !chipIri(mentionedWebId)) throw new TypeError("Invalid mention IRI");
  return {
    ...mentionDraft(resource, resource),
    summary: `Mentioned you: ${excerpt.slice(0, 280)}`,
  };
}

/** The text composers use readable explicit links, with kind in an optional title. */
export function chipText(ref: ChipRef): string {
  if (!chipIri(ref.iri)) throw new TypeError("Invalid chip IRI");
  const label = ref.label.replace(/[%[\]\n\r]/g, encodeURIComponent);
  return `@[${label}](${ref.iri.replaceAll("(", "%28").replaceAll(")", "%29")} "chip:${ref.kind}")`;
}

export interface TextChip {
  ref: ChipRef;
  from: number;
  to: number;
}
export function textChips(text: string): TextChip[] {
  const result: TextChip[] = [];
  for (const match of text.matchAll(/@\[([^\]\n]*)\]\((https?:\/\/[^\s<>]+) "chip:([a-z]+)"\)/g)) {
    const [, label = "", iri = "", kind = ""] = match;
    if (!chipIri(iri) || !chipKinds.includes(kind as ChipKind)) continue;
    try {
      result.push({
        ref: { iri, kind: kind as ChipKind, label: decodeURIComponent(label) },
        from: match.index,
        to: match.index + match[0].length,
      });
    } catch {
      /* Malformed percent escapes remain ordinary text. */
    }
  }
  return result;
}

/** Ignore email addresses, code blocks and a completed explicit mention. */
export function chipQuery(
  text: string,
  caret: number,
): { query: string; from: number; to: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([^@\n[\]`]{0,80})$/.exec(before);
  if (!match || (before.match(/```/g)?.length ?? 0) % 2) return null;
  return { query: match[1] as string, from: caret - (match[1] as string).length - 1, to: caret };
}

/** Stable resource/person keys for durable once-on-save delivery receipts. */
export function mentionKey(resource: string, webId: string): string {
  return `suite-mention:${encodeURIComponent(resource)}:${encodeURIComponent(webId)}`;
}
