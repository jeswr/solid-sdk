// AUTHORED-BY Codex GPT-6
import type { MetricKind } from "../model";
import { CATALOGUE, type HealthStore, loadMeasurements, summarizeMetric } from "./metrics";

export async function loadDashboard(store: HealthStore, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const entries = await loadMeasurements(store, { start, end: new Date(now.getTime() + 1) });
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setUTCDate(week.getUTCDate() - 6);
  const previous = new Date(week);
  previous.setUTCDate(previous.getUTCDate() - 7);
  return CATALOGUE.map((metric) => {
    const kind: MetricKind = metric.kinds[0];
    const all = entries.filter((entry) => entry.kind === kind);
    const current = summarizeMetric(
      all.filter((entry) => entry.at >= week),
      kind,
      "day",
    );
    const before = summarizeMetric(
      all.filter((entry) => entry.at >= previous && entry.at < week),
      kind,
      "day",
    );
    const latest = summarizeMetric(all, kind, "day").latest;
    const secondary = entries
      .filter((entry) => entry.kind === "diastolic" && entry.at.getTime() === latest?.at.getTime())
      .at(-1);
    const change =
      before.average && current.average !== null
        ? ((current.average - before.average) / before.average) * 100
        : null;
    return { ...metric, entries: all, latest, secondary, buckets: current.buckets, change };
  });
}
