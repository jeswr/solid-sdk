// AUTHORED-BY Codex (GPT-6.1 Sol)
import { pearson as coefficientOf } from "@jeswr/suite-charts/scale";
export type Strength =
  | "insufficient data"
  | "no variation"
  | "negligible"
  | "weak"
  | "moderate"
  | "strong";
export interface Correlation {
  coefficient: number | null;
  n: number;
  strength: Strength;
}
export function mean(values: readonly number[]): number | null {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((total, v) => total + v / valid.length, 0) : null;
}
export function robustSummary(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (fraction: number): number | null => {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * fraction;
    const low = sorted[Math.floor(at)] as number;
    const high = sorted[Math.ceil(at)] as number;
    const weight = at - Math.floor(at);
    return low * (1 - weight) + high * weight;
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const iqr = q1 === null || q3 === null ? null : q3 - q1;
  return {
    n: sorted.length,
    median: quantile(0.5),
    q1,
    q3,
    iqr,
    outliers:
      iqr === null
        ? []
        : sorted.filter((v) => v < (q1 as number) - 1.5 * iqr || v > (q3 as number) + 1.5 * iqr),
  };
}
export function pearson(x: readonly number[], y: readonly number[]): Correlation {
  if (x.length !== y.length) throw new RangeError("Paired arrays must have equal lengths");
  const pairs = x.flatMap((a, i) =>
    Number.isFinite(a) && Number.isFinite(y[i]) ? [[a, y[i] as number] as const] : [],
  );
  const n = pairs.length;
  if (n < 2) return { coefficient: null, n, strength: "insufficient data" };
  // Normalisation keeps the shared coefficient calculation finite for extreme inputs.
  const scaleX = pairs.reduce((max, [a]) => Math.max(max, Math.abs(a)), 0) || 1;
  const scaleY = pairs.reduce((max, [, b]) => Math.max(max, Math.abs(b)), 0) || 1;
  const a = pairs.map(([v]) => v / scaleX);
  const b = pairs.map(([, v]) => v / scaleY);
  const varies = (values: number[]) => {
    const centre = mean(values) as number;
    const variance = values.reduce((sum, v) => sum + (v - centre) ** 2 / n, 0);
    // Relative to squared maximum amplitude, preserving invariance to unit changes.
    return variance > 1e-12;
  };
  if (!varies(a) || !varies(b)) return { coefficient: null, n, strength: "no variation" };
  // The public analysis API accepts two paired values; scale requires three.
  const coefficient = coefficientOf(
    n === 2 ? [...a, ...a] : a,
    n === 2 ? [...b, ...b] : b,
  ) as number;
  const magnitude = Math.abs(coefficient);
  return {
    coefficient,
    n,
    strength:
      magnitude < 0.1
        ? "negligible"
        : magnitude < 0.3
          ? "weak"
          : magnitude < 0.7
            ? "moderate"
            : "strong",
  };
}
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const result: number[] = [];
  for (let i = 0; i < order.length; ) {
    let end = i + 1;
    while (end < order.length && order[end]?.value === order[i]?.value) end++;
    for (let j = i; j < end; j++) result[(order[j] as { i: number }).i] = (i + end + 1) / 2;
    i = end;
  }
  return result;
}
export function spearman(x: readonly number[], y: readonly number[]): Correlation {
  if (x.length !== y.length) throw new RangeError("Paired arrays must have equal lengths");
  const pairs = x.flatMap((v, i) =>
    Number.isFinite(v) && Number.isFinite(y[i]) ? [[v, y[i] as number] as const] : [],
  );
  return pearson(ranks(pairs.map(([v]) => v)), ranks(pairs.map(([, v]) => v)));
}
