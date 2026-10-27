// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ColourAnchor } from "./model";
import { invalidRule } from "./validation";

/** Multiply before dividing for consistent anchors, falling back on overflow. */
export function interpolate(low: number, high: number, numerator: number, denominator = 1): number {
  if (low === high || numerator === 0) return low;
  if (numerator === denominator) return high;
  const product = (high - low) * numerator;
  const fraction = numerator / denominator;
  const value = Number.isFinite(product)
    ? low + product / denominator
    : low * (1 - fraction) + high * fraction;
  return Math.max(Math.min(low, high), Math.min(Math.max(low, high), value));
}

function position(anchor: ColourAnchor, numbers: readonly number[]): number {
  const min = numbers[0] as number;
  const max = numbers[numbers.length - 1] as number;
  switch (anchor.kind) {
    case "min":
      return min;
    case "max":
      return max;
    case "number":
      return anchor.value;
    case "percent":
      return interpolate(min, max, anchor.value, 100);
    case "percentile": {
      const rank = ((numbers.length - 1) * anchor.value) / 100;
      const lower = Math.floor(rank);
      return interpolate(
        numbers[lower] as number,
        numbers[Math.ceil(rank)] as number,
        rank - lower,
      );
    }
  }
}

function interpolateRgb(from: string, to: string, fraction: number): string {
  let result = "#";
  for (const offset of [1, 3, 5]) {
    const low = Number.parseInt(from.slice(offset, offset + 2), 16);
    const high = Number.parseInt(to.slice(offset, offset + 2), 16);
    result += Math.round(interpolate(low, high, fraction))
      .toString(16)
      .padStart(2, "0");
  }
  return result.toUpperCase();
}

export function colourScale(
  anchors: readonly ColourAnchor[],
  numbers: readonly number[],
): (value: number) => string {
  const points = anchors.map((anchor) => ({ at: position(anchor, numbers), color: anchor.color }));
  for (let index = 1; index < points.length; index++) {
    if (
      (points[index - 1] as (typeof points)[number]).at >
      (points[index] as (typeof points)[number]).at
    )
      invalidRule();
  }
  return (value) => {
    const first = points[0] as (typeof points)[number];
    if (value <= first.at) return first.color;
    for (let index = 1; index < points.length; index++) {
      const lower = points[index - 1] as (typeof points)[number];
      const upper = points[index] as (typeof points)[number];
      if (value <= upper.at) {
        const span = upper.at - lower.at;
        let fraction: number;
        if (Number.isFinite(span)) {
          fraction = (value - lower.at) / span;
        } else {
          const scale = Math.max(Math.abs(lower.at), Math.abs(upper.at));
          fraction = (value / scale - lower.at / scale) / (upper.at / scale - lower.at / scale);
        }
        return interpolateRgb(lower.color, upper.color, fraction);
      }
    }
    return (points[points.length - 1] as (typeof points)[number]).color;
  };
}
