// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { codePointOrder } from "./assistant-import.js";
import { endInstant, lexicalTime } from "./temporal.js";
import type {
  HealthFilterOptions,
  HealthGraphView,
  HealthTimeline,
  ObservationSeries,
  TimelineKind,
} from "./types.js";
/** Numeric, dated observations only; skipped counts eligible observations with unusable values/times. */
export function observationSeries(
  view: HealthGraphView,
  options: HealthFilterOptions = {},
): { series: ObservationSeries[]; skipped: number } {
  const groups = new Map<string, ObservationSeries>();
  let skipped = 0;
  for (const fact of view.byKind.observation) {
    if (fact.kind !== "observation" || (options.beliefs && !options.beliefs.includes(fact.belief)))
      continue;
    const time = fact.effectiveTimeMs ?? fact.period.startTime;
    if (
      typeof fact.value !== "number" ||
      !Number.isFinite(fact.value) ||
      time === undefined ||
      !Number.isFinite(time)
    ) {
      skipped += 1;
      continue;
    }
    const key =
      fact.code?.iri ??
      (fact.code?.value
        ? [fact.code.system, fact.code.value]
        : fact.label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase());
    const id = JSON.stringify([key, fact.unit ?? null]);
    const group = groups.get(id) ?? { id, label: fact.label, unit: fact.unit, points: [] };
    group.points.push({
      x: new Date(time).toISOString(),
      y: fact.value,
      factId: fact.id,
      belief: fact.belief,
      ...(fact.affectedBySkipped ? { affectedBySkipped: true as const } : {}),
      ...(fact.provenanceUnavailable ? { provenanceUnavailable: true as const } : {}),
    });
    groups.set(id, group);
  }
  const series = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const group of series)
    group.points.sort(
      (a, b) => Date.parse(a.x) - Date.parse(b.x) || a.factId.localeCompare(b.factId),
    );
  return { series, skipped };
}
/** Undated items first, then parsed start time, then unparsable starts; ties by lexical start and ID. */
function timelineOrder(
  a: { start?: string; id: string; time?: number },
  b: { start?: string; id: string; time?: number },
): number {
  const rank = (item: { start?: string; time?: number }) =>
    item.start === undefined ? 0 : item.time === undefined ? 2 : 1;
  return (
    rank(a) - rank(b) ||
    (a.time ?? 0) - (b.time ?? 0) ||
    codePointOrder(a.start ?? "", b.start ?? "") ||
    codePointOrder(a.id, b.id)
  );
}
/** History is retained by default; callers may filter by belief before rendering. */
export function healthTimeline(
  view: HealthGraphView,
  options: HealthFilterOptions = {},
): HealthTimeline {
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  const lanes: HealthTimeline = {
    condition: [],
    medication: [],
    immunization: [],
    encounter: [],
    documents: [],
  };
  for (const kind of Object.keys(lanes) as TimelineKind[]) {
    const items: (HealthTimeline[TimelineKind][number] & { time?: number })[] = [];
    for (const fact of view.byKind[kind === "documents" ? "document" : kind]) {
      if (options.beliefs && !options.beliefs.includes(fact.belief)) continue;
      if (fact.kind === "document" && fact.dateCreated === undefined) continue;
      const start =
        (fact.kind === "document" ? fact.dateCreated : fact.period.start) ??
        (fact.kind === "encounter" || fact.kind === "immunization" ? fact.date : undefined);
      const end = fact.period.end;
      // An end date in the future means ongoing; a date-precision end includes its
      // whole day (month, year). An end that cannot be parsed, or an invalid clock,
      // never gives `active` and never claims the period ended.
      const ended =
        end !== undefined &&
        (fact.period.endTime === undefined || !Number.isFinite(now)
          ? undefined
          : endInstant(end, fact.period.endTime) <= now);
      items.push({
        id: fact.id,
        label: fact.label,
        start,
        end,
        belief: fact.belief,
        ...(fact.affectedBySkipped ? { affectedBySkipped: true as const } : {}),
        ...(fact.provenanceUnavailable ? { provenanceUnavailable: true as const } : {}),
        // An unreadable later update means the fact may have changed: never show it as active.
        tone:
          fact.belief === "past" || ended === true
            ? "past"
            : ended === undefined
              ? "neutral"
              : fact.validity === "Current" && !fact.affectedBySkipped
                ? "active"
                : "neutral",
        time: start === undefined ? undefined : lexicalTime(start),
      });
    }
    lanes[kind] = items.sort(timelineOrder).map(({ time: _time, ...item }) => item);
  }
  return lanes;
}
