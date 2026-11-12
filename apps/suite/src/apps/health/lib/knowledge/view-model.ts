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
import { toTime } from "@jeswr/suite-charts/scale";

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
  const current = view.facts.filter((f) => f.belief === "definitely" && f.validity === "Current");
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
  return times.length ? Math.max(...times) : Date.parse(fact.provenance.generatedAt) || 0;
}
export function needsReview(view: HealthGraphView) {
  return view.facts
    .filter((f) => f.belief === "might" || f.validity === "Contradicted" || !!f.hedge)
    .sort((a, b) => evidenceTime(b) - evidenceTime(a) || a.label.localeCompare(b.label));
}
export function bodySystemGroups(view: HealthGraphView) {
  return SYSTEMS.map((id) => {
    const facts = view.facts.filter((f) => classifyBodySystem(f) === id);
    return { id, count: facts.length, labels: [...new Set(facts.map((f) => f.label))].slice(0, 3) };
  });
}
export function sourceCounts(view: HealthGraphView) {
  return view.sources.map((source) => ({
    ...source,
    count: view.facts.filter((f) => f.provenance.sources.some((s) => s.iri === source.iri)).length,
  }));
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
