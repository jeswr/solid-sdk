// AUTHORED-BY Codex GPT-6.1-Sol
import type { XValue } from "./types.js";

export type { XValue } from "./types.js";

/** ISO calendar dates use UTC; date-times without an offset also use UTC. */
export function toTime(x: XValue): number {
  if (typeof x === "number") return x;
  if (x instanceof Date) {
    const value = x.getTime();
    if (!Number.isFinite(value)) throw new TypeError("Invalid Date");
    return value;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      x,
    );
  if (!match) throw new TypeError("Expected an ISO 8601 date or date-time");
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day
  ) {
    throw new TypeError("Invalid ISO calendar date");
  }
  const withZone = x.includes("T") && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(x) ? `${x}Z` : x;
  const value = Date.parse(withZone);
  if (!Number.isFinite(value)) throw new TypeError("Invalid ISO date-time");
  return value;
}

/** Unclamped affine mapping. A constant domain maps to the range midpoint. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]) {
  if (![...domain, ...range].every(Number.isFinite))
    throw new TypeError("Scale bounds must be finite");
  const [a, b] = domain,
    [c, d] = range;
  return (value: number) => {
    if (a === b) return c / 2 + d / 2;
    // Halving avoids overflow for domains spanning both extremes of the number range.
    const t = Number.isFinite(b - a)
      ? (value - a) / (b - a)
      : (value / 2 - a / 2) / (b / 2 - a / 2);
    return (1 - t) * c + t * d;
  };
}
export function timeScale(domain: readonly [XValue, XValue], range: readonly [number, number]) {
  const scale = linearScale([toTime(domain[0]), toTime(domain[1])], range);
  return (value: XValue) => scale(toTime(value));
}

/** About count inclusive, human-readable ticks within the domain. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (![min, max, count].every(Number.isFinite))
    throw new TypeError("Tick bounds and count must be finite");
  if (count < 1) return [];
  if (min === max || count < 2) return [min];
  if (min > max) return niceTicks(max, min, count).reverse();
  const raw = (max - min) / Math.max(1, Math.min(1000, Math.floor(count)) - 1);
  if (!Number.isFinite(raw) || raw === 0) return [min, max];
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  if (!Number.isFinite(step) || step === 0) return [min, max];
  const first = Math.ceil(min / step),
    last = Math.floor(max / step);
  const ticks: number[] = [];
  for (let i = 0; i <= Math.min(1000, last - first); i++) {
    const value = Number(((first + i) * step).toPrecision(14));
    ticks.push(Object.is(value, -0) ? 0 : value);
  }
  return ticks.length ? ticks : [min, max];
}

function moments(xs: readonly number[], ys: readonly number[]) {
  if (xs.length !== ys.length) throw new RangeError("x and y lengths must match");
  if (![...xs, ...ys].every(Number.isFinite) || !xs.length) return undefined;
  let meanX = 0,
    meanY = 0,
    xx = 0,
    yy = 0,
    xy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] ?? 0,
      y = ys[i] ?? 0;
    const dx = x - meanX,
      dy = y - meanY;
    meanX += dx / (i + 1);
    meanY += dy / (i + 1);
    xx += dx * (x - meanX);
    yy += dy * (y - meanY);
    xy += dx * (y - meanY);
  }
  return { meanX, meanY, xx, yy, xy };
}
export function pearson(xs: readonly number[], ys: readonly number[]): number | undefined {
  const m = moments(xs, ys);
  if (xs.length < 3 || !m || m.xx <= 0 || m.yy <= 0) return undefined;
  const value = m.xy / Math.sqrt(m.xx) / Math.sqrt(m.yy);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : undefined;
}
export function leastSquares(
  points: readonly { x: number; y: number }[],
): { slope: number; intercept: number } | undefined {
  const m = moments(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  if (points.length < 2 || !m || m.xx <= 0) return undefined;
  const slope = m.xy / m.xx,
    intercept = m.meanY - slope * m.meanX;
  return Number.isFinite(slope) && Number.isFinite(intercept) ? { slope, intercept } : undefined;
}
