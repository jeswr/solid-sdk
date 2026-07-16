// AUTHORED-BY GPT-5.6 Sol via codex

import type { SubStream } from "./types.js";

function cyrb128(value: string): [number, number, number, number] {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

class XoshiroSubStream implements SubStream {
  readonly #key: string;
  #state: [number, number, number, number];

  constructor(key: string) {
    this.#key = key;
    this.#state = cyrb128(key);
    if (this.#state.every((word) => word === 0)) {
      this.#state[0] = 1;
    }
  }

  #nextUint32(): number {
    const [s0, s1, s2, s3] = this.#state;
    const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9) >>> 0;
    const temporary = (s1 << 9) >>> 0;
    this.#state = [
      (s0 ^ s3) >>> 0,
      (s1 ^ s2) >>> 0,
      (s2 ^ s0 ^ temporary) >>> 0,
      rotateLeft((s3 ^ s1) >>> 0, 11),
    ];
    return result;
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (
      !Number.isSafeInteger(minInclusive) ||
      !Number.isSafeInteger(maxInclusive) ||
      maxInclusive < minInclusive
    ) {
      throw new RangeError(`Invalid deterministic integer range ${minInclusive}..${maxInclusive}`);
    }
    const width = maxInclusive - minInclusive + 1;
    if (width > 0x1_0000_0000) {
      const widthBigInt = BigInt(maxInclusive) - BigInt(minInclusive) + 1n;
      const sourceWidth = 1n << 64n;
      const limit = sourceWidth - (sourceWidth % widthBigInt);
      let draw = (BigInt(this.#nextUint32()) << 32n) | BigInt(this.#nextUint32());
      while (draw >= limit) {
        draw = (BigInt(this.#nextUint32()) << 32n) | BigInt(this.#nextUint32());
      }
      return Number(BigInt(minInclusive) + (draw % widthBigInt));
    }
    if (width === 0x1_0000_0000) {
      return minInclusive + this.#nextUint32();
    }
    const limit = Math.floor(0x1_0000_0000 / width) * width;
    let draw = this.#nextUint32();
    while (draw >= limit) {
      draw = this.#nextUint32();
    }
    return minInclusive + (draw % width);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("Cannot pick from an empty deterministic collection");
    }
    const selected = items[this.int(0, items.length - 1)];
    if (selected === undefined) {
      throw new RangeError("Deterministic collection index was unexpectedly absent");
    }
    return selected;
  }

  fork(key: string): SubStream {
    return new XoshiroSubStream(`${this.#key}\u0000${key}`);
  }
}

export function coordinateStream(
  seed: string,
  shape: string,
  instanceIndex: number,
  path: string,
  occurrence: number | "count",
): SubStream {
  return new XoshiroSubStream(
    [seed, shape, String(instanceIndex), path, String(occurrence)].join("\u0000"),
  );
}
