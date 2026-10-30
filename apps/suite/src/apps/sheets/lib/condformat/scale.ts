// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ColourAnchor } from "./model";
import { invalidRule } from "./validation";

/** Represent any finite double exactly as integer multiples of 2^-1074. */
function binaryUnits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  const fraction = bits & BigInt("0xfffffffffffff");
  const significand = exponent === 0 ? fraction : fraction + BigInt("0x10000000000000");
  const units = significand << BigInt(Math.max(0, exponent - 1));
  return value < 0 ? -units : units;
}

/** Preserve the complete affine expression, then round once to a double. */
export function interpolate(low: number, high: number, numerator: number, denominator = 1): number {
  if (low === high || numerator === 0) return low;
  if (numerator === denominator) return high;
  const lower = binaryUnits(low);
  const divisor = binaryUnits(denominator);
  const dividend = lower * divisor + (binaryUnits(high) - lower) * binaryUnits(numerator);
  const zero = BigInt(0);
  const magnitude = dividend < zero ? -dividend : dividend;
  // Keep 53 significant bits, or single subnormal units, and round ties to even.
  const shift = Math.max(0, (magnitude / divisor).toString(2).length - 53);
  const scaledDivisor = divisor << BigInt(shift);
  let rounded = magnitude / scaledDivisor;
  const remainder = (magnitude % scaledDivisor) * BigInt(2);
  if (remainder > scaledDivisor || (remainder === scaledDivisor && rounded % BigInt(2) !== zero)) {
    rounded += BigInt(1);
  }
  return (dividend < zero ? -1 : 1) * Number(rounded) * 2 ** (shift - 1074);
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
      const numerator = (numbers.length - 1) * anchor.value;
      const rank = numerator / 100;
      const lower = Math.floor(rank);
      return interpolate(
        numbers[lower] as number,
        numbers[Math.ceil(rank)] as number,
        numerator - lower * 100,
        100,
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
