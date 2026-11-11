// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { InboundMessage } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { isLoaded, type Row } from "./client";
import { isComplete } from "./collections";
import { PROV } from "./paths";
import type { DisplayControl } from "./readers";

export interface StructuredCard {
  kind: "calendar" | "jsonld";
  title: string;
  type?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  location?: string | undefined;
  model: boolean;
}
/** Project only known typed fields. HTML alternatives never become cards or markup. */
export async function structuredCards(
  parts: InboundMessage["structuredPart"],
): Promise<StructuredCard[]> {
  const cards = await Promise.all(
    parts.map(async (value): Promise<StructuredCard[]> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const text = (key: string) =>
        typeof value[key] === "string" ? (value[key] as string) : undefined;
      const type = text("type") ?? text("@type");
      const provenance = value.provenance;
      let model =
        value.modelProvenance !== undefined ||
        value.generatedBy !== undefined ||
        provenance === "model" ||
        (!!provenance &&
          typeof provenance === "object" &&
          !Array.isArray(provenance) &&
          (provenance.type === "model" ||
            provenance.model !== undefined ||
            provenance.generatedBy !== undefined));
      if (type === "text/html") return [];
      if (!type) return [];
      try {
        // Expand inline JSON-LD aliases/prefixes; parseRdf refuses remote contexts by default.
        const context = value["@context"];
        const graph = await parseRdf(
          JSON.stringify({
            ...value,
            "@context": [
              { prov: PROV },
              ...(Array.isArray(context) ? context : context === undefined ? [] : [context]),
            ],
          }),
          "application/ld+json",
        );
        model ||= [...graph].some((q) => q.predicate.value === `${PROV}wasGeneratedBy`);
      } catch {
        // Unreadable provenance must never be presented as deterministic extraction.
        model = true;
      }
      if (type === "text/calendar" || type === "Event" || type === "https://schema.org/Event")
        return [
          {
            kind: "calendar",
            title: text("title") ?? text("name") ?? "Calendar event",
            start: text("start") ?? text("startDate"),
            end: text("end") ?? text("endDate"),
            location: text("location"),
            model,
          },
        ];
      return [
        {
          kind: "jsonld",
          title: text("name") ?? "Structured data",
          type: type
            .replace(/^https?:\/\/(schema.org\/)?/, "")
            .split(/[/#]/)
            .at(-1),
          model,
        },
      ];
    }),
  );
  return cards.flat();
}
const LABELS: Record<string, string> = Object.assign(Object.create(null), {
  meeting: "Meeting",
  action: "Action needed",
  "action-required": "Action needed",
  informational: "For your information",
  personal: "Personal",
  spam: "Possible spam",
  newsletter: "Newsletter",
});
export function triageLabel(value: string | undefined): string {
  return value
    ? Object.hasOwn(LABELS, value)
      ? (LABELS[value] as string)
      : value
    : "Not assessed";
}

/** Messages the owner archived: verified, owner-attributed Archive controls in force at `now`. */
export function archivedMessages(
  controls: readonly DisplayControl[],
  owner: string,
  now: number,
): Set<string> {
  return new Set(
    controls
      .filter(
        (c) =>
          c.kind === "Archive" &&
          c.verification === "verified" &&
          c.attributedTo === owner &&
          c.target !== undefined &&
          Date.parse(c.createdAt) <= now &&
          Date.parse(c.expires) > now,
      )
      .map((c) => c.target as string),
  );
}

/**
 * The archive as the Inbox may present it. A partial or failed read must never look like an
 * empty archive, or archived messages would quietly come back.
 */
export type ArchiveView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready" | "partial"; targets: Set<string> };
export function archiveView(
  query: { status: "loading" | "error" } | { status: "ready"; data: Row<DisplayControl>[] },
  owner: string,
  now: number,
): ArchiveView {
  if (query.status !== "ready") return { status: query.status };
  const rows = query.data;
  const targets = archivedMessages(
    rows.filter(isLoaded<DisplayControl>).map((row) => row.record),
    owner,
    now,
  );
  // Truncated listings and unreadable archive documents both leave archives unchecked.
  const partial = !isComplete(rows) || rows.some((row) => !isLoaded(row));
  return { status: partial ? "partial" : "ready", targets };
}
