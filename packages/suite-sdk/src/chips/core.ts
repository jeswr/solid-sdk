// AUTHORED-BY Codex GPT-6.1-Sol
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
    return (
      /^https?:\/\//i.test(value) &&
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      !/\s/.test(value)
    );
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

export interface ResolvedChip extends ChipRef {
  icon: ChipKind | "lock";
  readable: boolean;
  owner?: string;
}

export function chipHref(ref: ChipRef, encodeRef: (iri: string) => string): string {
  if (!chipIri(ref.iri)) return ref.iri;
  const kind =
    (
      {
        docs: "doc",
        notes: "note",
        sheets: "sheet",
        calendar: "event",
        tasks: "task",
        contacts: "person",
        drive: "file",
      } as Record<string, ChipKind>
    )[ref.app ?? ""] ?? ref.kind;
  const document = new URL(ref.iri);
  document.hash = "";
  const encoded = encodeRef(document.href);
  if (kind === "doc") return `/docs/d/${encoded}`;
  if (kind === "note") return `/notes/n/${encoded}`;
  if (kind === "sheet") return `/sheets/s/${encoded}`;
  if (kind === "event") return `/calendar/e/${encoded}`;
  if (kind === "task") return `/tasks/inbox?task=${encodeRef(ref.iri)}`;
  if (kind === "person") return ref.iri;
  if (kind === "file") return `/drive/${document.pathname.endsWith("/") ? "f" : "p"}/${encoded}`;
  return ref.iri;
}
