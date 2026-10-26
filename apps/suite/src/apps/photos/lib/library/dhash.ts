// AUTHORED-BY Codex GPT-6.1-Sol

/**
 * Horizontal 64-bit dHash, represented as a bit string to avoid integer precision
 * loss. Input is an already oriented/resized 9×8 row-major grayscale sample.
 * Values may be fractional but must be finite within 0–255. Each row contributes
 * eight bits, left to right: 1 when the left pixel is brighter, 0 otherwise.
 * Decoding, grayscale conversion and resampling are the caller's responsibility.
 */
export function dHash(pixels: ArrayLike<number>): string {
  if (pixels.length !== 72) throw new RangeError("dHash requires a 9×8 grayscale sample");
  for (let index = 0; index < pixels.length; index++) {
    const pixel = pixels[index];
    if (pixel === undefined || !Number.isFinite(pixel) || pixel < 0 || pixel > 255) {
      throw new RangeError("Grayscale samples must be finite numbers between 0 and 255");
    }
  }
  let hash = "";
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const left = pixels[row * 9 + column] as number;
      const right = pixels[row * 9 + column + 1] as number;
      hash += left > right ? "1" : "0";
    }
  }
  return hash;
}

/** Hamming distance in [0, 64]. Both inputs must be 64-character binary dHashes. */
export function hammingDistance(left: string, right: string): number {
  const pattern = /^[01]+$/;
  if (left.length !== 64 || right.length !== 64 || !pattern.test(left) || !pattern.test(right)) {
    throw new RangeError("dHashes must contain exactly 64 binary digits");
  }
  let distance = 0;
  for (let index = 0; index < 64; index++) {
    if (left[index] !== right[index]) distance++;
  }
  return distance;
}

/** Candidate similarity only: dHash collisions do not prove that files are duplicates. */
export function isDuplicateCandidate(left: string, right: string, maxDistance: number): boolean {
  if (!Number.isInteger(maxDistance) || maxDistance < 0 || maxDistance > 64) {
    throw new RangeError("Duplicate threshold must be an integer between 0 and 64");
  }
  return hammingDistance(left, right) <= maxDistance;
}
