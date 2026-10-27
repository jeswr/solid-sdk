// AUTHORED-BY Codex GPT-6.1-Sol
import type { ColourAnchor } from "./model";
import { invalidRule } from "./validation";

/** Weighted interpolation avoids overflowing (high - low) for finite opposite extremes. */
export function interpolate(low: number, high: number, fraction: number): number {
  return low * (1 - fraction) + high * fraction;
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
      return interpolate(min, max, anchor.value / 100);
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
        const scale = Math.max(Math.abs(lower.at), Math.abs(upper.at));
        const fraction = (value / scale - lower.at / scale) / (upper.at / scale - lower.at / scale);
        return interpolateRgb(lower.color, upper.color, fraction);
      }
    }
    return (points[points.length - 1] as (typeof points)[number]).color;
  };
}
