// AUTHORED-BY Codex GPT-6.1-Sol
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
    group.points.push({ x: new Date(time).toISOString(), y: fact.value, factId: fact.id });
    groups.set(id, group);
  }
  const series = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const group of series)
    group.points.sort(
      (a, b) => Date.parse(a.x) - Date.parse(b.x) || a.factId.localeCompare(b.factId),
    );
  return { series, skipped };
}
/** History is retained by default; callers may filter by belief before rendering. */
export function healthTimeline(
  view: HealthGraphView,
  options: HealthFilterOptions = {},
): HealthTimeline {
  const lanes: HealthTimeline = { condition: [], medication: [], immunization: [], encounter: [] };
  for (const kind of Object.keys(lanes) as TimelineKind[]) {
    for (const fact of view.byKind[kind]) {
      if (options.beliefs && !options.beliefs.includes(fact.belief)) continue;
      lanes[kind].push({
        id: fact.id,
        label: fact.label,
        start:
          fact.period.start ??
          (fact.kind === "encounter" || fact.kind === "immunization" ? fact.date : undefined),
        end: fact.period.end,
        tone:
          fact.period.end !== undefined || fact.belief === "past"
            ? "past"
            : fact.validity === "Current"
              ? "active"
              : "neutral",
      });
    }
    lanes[kind].sort(
      (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.id.localeCompare(b.id),
    );
  }
  return lanes;
}
