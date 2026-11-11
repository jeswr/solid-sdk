// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type AlignedPoint, alignDaily, type Series } from "./series.js";
import { type Correlation, mean, pearson, robustSummary, spearman } from "./statistics.js";
export type Confidence = "low" | "moderate" | "high";
export function laggedCorrelation(x: Series, y: Series, timeZone: string, lagDays = 0) {
  const pairs = alignDaily(x.points, y.points, {
    timeZone,
    lagDays,
    xAggregation: x.aggregation,
    yAggregation: y.aggregation,
  });
  const a = pairs.map((p) => p.x as number);
  const b = pairs.map((p) => p.y as number);
  return { pairs, pearson: pearson(a, b), spearman: spearman(a, b) };
}
export function correlationVerdict(result: Correlation): string {
  if (result.n < 14)
    return `There are ${result.n} paired days; at least 14 are needed to show a finding.`;
  if (result.coefficient === null) return "These values do not vary enough to compare.";
  if (Math.abs(result.coefficient) < 0.3)
    return `There is no clear relationship in these ${result.n} paired days.`;
  return `These ${result.n} paired days show a ${result.strength} ${result.coefficient < 0 ? "negative" : "positive"} relationship; this does not establish cause and effect.`;
}
export interface Finding {
  id: string;
  xId: string;
  yId: string;
  lagDays: number;
  correlation: Correlation;
  rankCorrelation: Correlation;
  confidence: Confidence;
  description: string;
  pairs: AlignedPoint[];
}
/** Exploratory ranking, not a significance test. Never emits fewer than 14 paired days. */
export function insights(
  series: readonly Series[],
  options: { timeZone: string; lags?: readonly number[]; limit?: number },
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const x = series[i] as Series;
      const y = series[j] as Series;
      for (const lagDays of new Set(options.lags ?? [0, 1])) {
        const result = laggedCorrelation(x, y, options.timeZone, lagDays);
        const r = result.pearson;
        const rank = result.spearman.coefficient;
        if (
          r.n < 14 ||
          r.coefficient === null ||
          Math.abs(r.coefficient) < 0.3 ||
          rank === null ||
          Math.abs(rank) < 0.3 ||
          Math.sign(rank) !== Math.sign(r.coefficient)
        )
          continue;
        const threshold = robustSummary(result.pairs.map((p) => p.x as number)).median as number;
        const high = result.pairs
          .filter((p) => (p.x as number) > threshold)
          .map((p) => p.y as number);
        const low = result.pairs
          .filter((p) => (p.x as number) <= threshold)
          .map((p) => p.y as number);
        if (high.length < 7 || low.length < 7) continue;
        const diff = (mean(high) as number) - (mean(low) as number);
        const format = (v: number) =>
          new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(v);
        const confidence = r.n >= 60 ? "high" : r.n >= 30 ? "moderate" : "low";
        findings.push({
          id: JSON.stringify([x.id, y.id, lagDays]),
          xId: x.id,
          yId: y.id,
          lagDays,
          correlation: r,
          rankCorrelation: result.spearman,
          confidence,
          pairs: result.pairs,
          description: `On days with ${x.label.toLowerCase()} above ${format(threshold)} ${x.unit}, ${y.label.toLowerCase()} ${lagDays === 0 ? "on the same day" : `${Math.abs(lagDays)} day${Math.abs(lagDays) === 1 ? "" : "s"} ${lagDays > 0 ? "later" : "earlier"}`} averaged ${format(Math.abs(diff))} ${y.unit} ${diff < 0 ? "less" : "more"} than on other observed days (n=${r.n}, ${r.strength}).`,
        });
      }
    }
  }
  return findings
    .sort(
      (a, b) =>
        Math.abs(b.correlation.coefficient as number) * Math.sqrt(b.correlation.n) -
          Math.abs(a.correlation.coefficient as number) * Math.sqrt(a.correlation.n) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, options.limit ?? 6);
}
