// AUTHORED-BY Codex GPT-6.1-Sol

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** x' = a*x + c*y + e; y' = b*x + d*y + f (source rectangle edge coordinates). */
export type AffineTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export interface OrientationTransform {
  width: number;
  height: number;
  aspectRatio: number;
  matrix: AffineTransform;
}

/** All eight EXIF orientations, including mirrored forms, translated into positive bounds. */
export function getOrientationTransform(
  width: number,
  height: number,
  orientation = 1,
): OrientationTransform {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError("Image dimensions must be finite and positive");
  }
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new RangeError("EXIF orientation must be an integer from 1 to 8");
  }
  const matrices: Record<ExifOrientation, AffineTransform> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  const swapped = orientation >= 5;
  const displayWidth = swapped ? height : width;
  const displayHeight = swapped ? width : height;
  const aspectRatio = displayWidth / displayHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError("Image aspect ratio is not representable");
  }
  return {
    width: displayWidth,
    height: displayHeight,
    aspectRatio,
    matrix: matrices[orientation as ExifOrientation],
  };
}
