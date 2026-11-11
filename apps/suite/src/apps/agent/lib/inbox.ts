// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { InboundMessage } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { PROV } from "./paths";

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
