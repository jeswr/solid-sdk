// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Belief,
  type BodySystem,
  classifyBodySystem,
  type HealthFact,
  type HealthFactKind,
  type HealthGraphView,
  observationSeries,
} from "@jeswr/pkg-health";
import type { TemporalValue } from "@jeswr/pkg-memory";
import { toTime } from "@jeswr/suite-charts/scale";

/**
 * Largest local file the view will read. It matches the repository's 16 MiB RDF parse cap, so a
 * file the view accepts is also one the parser is meant to handle on the UI thread.
 */
export const MAX_KNOWLEDGE_FILE_BYTES = 16 * 1024 * 1024;
/** Most facts the view will hold; a file projecting to more is refused rather than rendered. */
export const MAX_KNOWLEDGE_FACTS = 20_000;
/** Rows, notes or charts shown before a "Show more" action. */
export const KNOWLEDGE_PAGE_SIZE = 50;
/** Items drawn per timeline lane; the rest stay available in Facts. */
export const MAX_TIMELINE_ITEMS_PER_LANE = 200;

type Flagged = { affectedBySkipped?: true; provenanceUnavailable?: true };
/** True when a later update could not be read or the source records are missing. */
export const isUncertain = (fact: Flagged): boolean =>
  !!fact.affectedBySkipped || !!fact.provenanceUnavailable;
export function uncertaintyNote(fact: Flagged): string {
  return [
    fact.affectedBySkipped ? "A later update to this could not be read." : "",
    fact.provenanceUnavailable ? "Its source details could not be read." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Chart coordinates use the first instant of partial dates; Facts retain their precision. */
export function timelineCoordinate(value?: string): number | undefined {
  if (!value) return undefined;
  const full = /^\d{4}$/.test(value)
    ? `${value}-01-01`
    : /^\d{4}-\d{2}$/.test(value)
      ? `${value}-01`
      : value;
  try {
    return toTime(full);
  } catch {
    return undefined;
  }
}

export const BELIEFS: { id: Belief; label: string }[] = [
  { id: "definitely", label: "Definitely" },
  { id: "might", label: "Might" },
  { id: "mentioned", label: "Mentioned" },
  { id: "past", label: "Past" },
];
export const KINDS: { id: HealthFactKind; label: string }[] = [
  { id: "condition", label: "Condition" },
  { id: "allergy", label: "Allergy" },
  { id: "medication", label: "Medication" },
  { id: "observation", label: "Observation" },
  { id: "immunization", label: "Immunisation" },
  { id: "encounter", label: "Encounter" },
  { id: "note", label: "Note" },
  { id: "document", label: "Document" },
];
const SYSTEMS: BodySystem[] = [
  "cardiovascular",
  "respiratory",
  "digestive",
  "endocrine and metabolic",
  "musculoskeletal",
  "nervous system",
  "mental health",
  "skin",
  "immune and allergy",
  "eyes and ears",
  "kidney and urinary",
  "reproductive and sexual health",
  "sleep",
  "general",
];
export const factKey = (fact: HealthFact) => JSON.stringify([fact.id, fact.subject, fact.kind]);
export const kindLabel = (kind: HealthFactKind) => KINDS.find((k) => k.id === kind)?.label ?? kind;
export const beliefLabel = (belief: Belief) =>
  BELIEFS.find((b) => b.id === belief)?.label ?? belief;
export function formatKnowledgeDate(value?: string): string {
  if (!value) return "Not recorded";
  if (/^\d{4}$/.test(value)) return value;
  if (!/^\d{4}-\d{2}(?:$|-\d{2}(?:$|T))/.test(value)) return value;
  const [year, month, day = "01"] = value.slice(0, 10).split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  )
    return value;
  const time = value.length === 7 ? date : new Date(timelineCoordinate(value) ?? Number.NaN);
  if (!Number.isFinite(time.getTime())) return value;
  return time.toLocaleDateString("en-GB", {
    ...(value.length === 7 ? {} : { day: "numeric" }),
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function factPeriod(fact: HealthFact): string {
  const start =
    fact.period.start ??
    (fact.kind === "observation"
      ? fact.effectiveTime
      : fact.kind === "document"
        ? fact.dateCreated
        : fact.kind === "immunization" || fact.kind === "encounter"
          ? fact.date
          : undefined);
  return `${formatKnowledgeDate(start)}${fact.period.end ? ` – ${formatKnowledgeDate(fact.period.end)}` : ""}`;
}
export function knowledgeStats(view: HealthGraphView) {
  const current = view.facts.filter(
    (f) => f.belief === "definitely" && f.validity === "Current" && !isUncertain(f),
  );
  return {
    conditions: current.filter((f) => f.kind === "condition").length,
    medications: current.filter((f) => f.kind === "medication").length,
    results: observationSeries(view).series.length,
    sources: view.sources.length,
  };
}
function evidenceTime(fact: HealthFact) {
  const times = fact.provenance.evidence
    .map((e) => Date.parse(e.timestamp ?? ""))
    .filter(Number.isFinite);
  if (!times.length) return Date.parse(fact.provenance.generatedAt) || 0;
  let latest = times[0] as number;
  for (const time of times) if (time > latest) latest = time;
  return latest;
}
export function needsReview(view: HealthGraphView) {
  return view.facts
    .filter(
      (f) => f.belief === "might" || f.validity === "Contradicted" || !!f.hedge || isUncertain(f),
    )
    .sort((a, b) => evidenceTime(b) - evidenceTime(a) || a.label.localeCompare(b.label));
}
export function bodySystemGroups(view: HealthGraphView) {
  return SYSTEMS.map((id) => {
    const facts = view.facts.filter((f) => classifyBodySystem(f) === id);
    return { id, count: facts.length, labels: [...new Set(facts.map((f) => f.label))].slice(0, 3) };
  });
}
export function sourceCounts(view: HealthGraphView) {
  const counts = new Map<string, number>();
  for (const fact of view.facts)
    for (const iri of new Set(fact.provenance.sources.map((s) => s.iri)))
      counts.set(iri, (counts.get(iri) ?? 0) + 1);
  return view.sources.map((source) => ({ ...source, count: counts.get(source.iri) ?? 0 }));
}

/**
 * Re-creates the recorded temporal literal for a date the user did not touch in a correction.
 * The projection keeps only the lexical form, so the datatype is read back from it. Returns
 * "unsupported" for forms the memory writer cannot store unchanged (for example zoned dates).
 */
export function preserveTemporal(
  value: string | undefined,
): TemporalValue | undefined | "unsupported" {
  if (!value) return undefined;
  if (/^\d{4}$/.test(value)) return { value, datatype: "gYear" };
  if (/^\d{4}-\d{2}$/.test(value)) return { value, datatype: "gYearMonth" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value, datatype: "date" };
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return { value, datatype: "dateTime" };
  return "unsupported";
}
/**
 * Why a fact cannot be corrected without losing recorded data, or "" when it can. A correction
 * rewrites the whole fact, so anything the writer cannot reproduce blocks it.
 */
export function correctionBlocker(fact: HealthFact): string {
  const reason =
    "This fact has details the correction form cannot keep, so correcting it here would lose data.";
  for (const bound of [fact.period.start, fact.period.end])
    if (preserveTemporal(bound) === "unsupported") return reason;
  if (fact.kind === "allergy" && fact.substance !== undefined && fact.substance !== fact.label)
    return reason;
  if (fact.kind === "condition" && fact.code && !(fact.code.iri && fact.code.value)) return reason;
  if (fact.kind === "medication") {
    if (fact.doseSchedule !== undefined && !fact.dose) return reason;
    if (fact.dose && !/^\d+(?:\.\d+)?$/.test(fact.dose.value.trim())) return reason;
  }
  return "";
}
export function filterFacts(
  view: HealthGraphView,
  filters: { beliefs?: readonly string[]; kinds?: readonly string[]; text?: string },
) {
  const query = filters.text?.trim().toLocaleLowerCase("en-GB") ?? "";
  return view.facts.filter(
    (f) =>
      (!filters.beliefs?.length || filters.beliefs.includes(f.belief)) &&
      (!filters.kinds?.length || filters.kinds.includes(f.kind)) &&
      (!query ||
        [
          f.label,
          f.kind,
          f.kind === "note" ? f.value : "",
          ...f.provenance.sources.flatMap((s) => [s.title ?? "", s.model ?? ""]),
        ]
          .join(" ")
          .toLocaleLowerCase("en-GB")
          .includes(query)),
  );
}
