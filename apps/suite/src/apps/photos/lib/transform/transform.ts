// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { record, requireTransform } from "./error";

/** Largest supported source axis in pixels. A half pixel must remain wider than
 * the normalized-coordinate precision lost when reflecting crop bounds. */
export const MAX_SOURCE_DIMENSION = 2 ** 50;

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** Normalized source-to-display affine matrix: x'=a*x+c*y+e; y'=b*x+d*y+f.
 * Coordinates use top-left origin and downward-positive y. Translation is normalized,
 * not pixels. Orient the entire source, then clip to the record's crop bounds. */
export type TransformMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];
export interface CropRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}
/** One JSON-compatible record; orientation includes EXIF plus every user transform.
 * Crop edges are relative to the full, currently oriented original, never its pixels. */
export interface PhotoEditRecord {
  readonly orientation: ExifOrientation;
  readonly crop: CropRect;
  /** Normalized extents on the original source axes, retained when display bounds
   * cannot reproduce them exactly. Preserve this field when saving the record. */
  readonly sourceExtent?: ImageSize;
}
export type PhotoEdit =
  | { readonly type: "rotate"; readonly degrees: number }
  | { readonly type: "flip"; readonly axis: "horizontal" | "vertical" }
  | { readonly type: "crop"; readonly rect: CropRect };

const matrices: Record<ExifOrientation, TransformMatrix> = {
  1: [1, 0, 0, 1, 0, 0],
  2: [-1, 0, 0, 1, 1, 0],
  3: [-1, 0, 0, -1, 1, 1],
  4: [1, 0, 0, -1, 0, 1],
  5: [0, 1, 1, 0, 0, 0],
  6: [0, 1, -1, 0, 1, 0],
  7: [0, -1, -1, 0, 1, 1],
  8: [0, -1, 1, 0, 0, 1],
};
const clockwise: Record<ExifOrientation, ExifOrientation> = {
  1: 6,
  2: 7,
  3: 8,
  4: 5,
  5: 2,
  6: 3,
  7: 4,
  8: 1,
};
const horizontal: Record<ExifOrientation, ExifOrientation> = {
  1: 2,
  2: 1,
  3: 4,
  4: 3,
  5: 6,
  6: 5,
  7: 8,
  8: 7,
};
const vertical: Record<ExifOrientation, ExifOrientation> = {
  1: 4,
  2: 3,
  3: 2,
  4: 1,
  5: 8,
  6: 7,
  7: 6,
  8: 5,
};

function orientation(value: unknown): ExifOrientation {
  requireTransform(
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8,
    "invalid-orientation",
  );
  return value as ExifOrientation;
}

export function orientationMatrix(value: unknown): TransformMatrix {
  // A fresh tuple keeps callers from mutating the normalization table.
  return [...matrices[orientation(value)]];
}
function cropRect(value: unknown): CropRect {
  const rect = record(value, ["left", "top", "right", "bottom"], "invalid-crop");
  const { left, top, right, bottom } = rect;
  requireTransform(
    [left, top, right, bottom].every((edge) => typeof edge === "number" && Number.isFinite(edge)),
    "invalid-crop",
  );
  requireTransform(
    (left as number) >= 0 &&
      (top as number) >= 0 &&
      (right as number) <= 1 &&
      (bottom as number) <= 1 &&
      (left as number) < (right as number) &&
      (top as number) < (bottom as number),
    "invalid-crop",
  );
  return { left, top, right, bottom } as CropRect;
}
function editRecord(value: unknown): PhotoEditRecord {
  const hasExtent =
    typeof value === "object" && value !== null && Object.hasOwn(value, "sourceExtent");
  const input = record(
    value,
    hasExtent ? ["orientation", "crop", "sourceExtent"] : ["orientation", "crop"],
    "invalid-record",
  );
  const state = orientation(input.orientation);
  const crop = cropRect(input.crop);
  if (!hasExtent) return { orientation: state, crop };
  const extent = record(input.sourceExtent, ["width", "height"], "invalid-record");
  requireTransform(
    ["width", "height"].every((axis) => {
      const n = extent[axis];
      return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1;
    }),
    "invalid-record",
  );
  return {
    orientation: state,
    crop,
    sourceExtent: { width: extent.width as number, height: extent.height as number },
  };
}
function imageSize(value: unknown): ImageSize {
  const input = record(value, ["width", "height"], "invalid-size");
  requireTransform(
    [input.width, input.height].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_SOURCE_DIMENSION,
    ),
    "invalid-size",
  );
  return { width: input.width, height: input.height } as ImageSize;
}

/** Call once with the source EXIF value (or explicitly choose identity when absent). */
export function createEditRecord(exifOrientation: unknown = 1): PhotoEditRecord {
  return {
    orientation: orientation(exifOrientation),
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
  };
}

/** Sequential edits in the current display frame. Positive degrees rotate clockwise.
 * Each crop selects a rectangle relative to the CURRENT visible crop, allowing repeated
 * crops to collapse into one record. Inputs are never mutated; unsupported edits throw. */
export function composeEdits(value: unknown, edits: unknown): PhotoEditRecord {
  let result = editRecord(value);
  let extent = result.sourceExtent ?? sourceExtent(result.orientation, result.crop);
  requireTransform(Array.isArray(edits), "invalid-edit");
  for (const edit of edits) {
    requireTransform(typeof edit === "object" && edit !== null, "invalid-edit");
    const { type } = edit;
    let { orientation: state, crop } = result;
    const { left, top, right, bottom } = crop;
    if (type === "crop") {
      const input = record(edit, ["type", "rect"], "invalid-edit");
      const rect = cropRect(input.rect);
      const width = right - left;
      const height = bottom - top;
      crop = cropRect({
        left: left + rect.left * width,
        top: top + rect.top * height,
        right: left + rect.right * width,
        bottom: top + rect.bottom * height,
      });
      const selected = sourceExtent(state, rect);
      extent = { width: extent.width * selected.width, height: extent.height * selected.height };
    } else if (type === "rotate") {
      const { degrees } = record(edit, ["type", "degrees"], "invalid-edit");
      requireTransform(
        typeof degrees === "number" && Number.isSafeInteger(degrees) && degrees % 90 === 0,
        "invalid-edit",
      );
      const turns = (((degrees % 360) + 360) % 360) / 90;
      for (let turn = 0; turn < turns; turn++) {
        state = clockwise[state];
        crop = { left: 1 - crop.bottom, top: crop.left, right: 1 - crop.top, bottom: crop.right };
      }
    } else {
      requireTransform(type === "flip", "invalid-edit");
      const { axis } = record(edit, ["type", "axis"], "invalid-edit");
      requireTransform(axis === "horizontal" || axis === "vertical", "invalid-edit");
      if (axis === "horizontal") {
        state = horizontal[state];
        crop = { left: 1 - right, top, right: 1 - left, bottom };
      } else {
        state = vertical[state];
        crop = { left, top: 1 - bottom, right, bottom: 1 - top };
      }
    }
    result = { orientation: state, crop: cropRect(crop) };
    const derived = sourceExtent(state, crop);
    if (derived.width !== extent.width || derived.height !== extent.height) {
      result = { ...result, sourceExtent: extent };
    }
  }
  return result;
}

function sourceExtent(state: ExifOrientation, crop: CropRect): ImageSize {
  const width = crop.right - crop.left;
  const height = crop.bottom - crop.top;
  return state >= 5 ? { width: height, height: width } : { width, height };
}

function roundCropExtent(pixels: number, fraction: number): number {
  const extent = pixels * fraction;
  const lower = Math.floor(extent);
  // Limit arithmetic tolerance to a billionth of a pixel, even for huge sources.
  const tolerance = Math.min(pixels * Number.EPSILON, 1e-9);
  return extent - lower >= 0.5 - tolerance ? Math.ceil(extent) : lower;
}

/** Natural output dimensions; round source-axis crop extents once, then orient.
 * Half-pixel ties round up; arithmetic tolerance is capped at a billionth of a pixel.
 * Subpixel results rounding to zero are rejected, never clamped or upscaled. */
export function computeOutputSize(source: unknown, value: unknown): ImageSize {
  const size = imageSize(source);
  const edit = editRecord(value);
  const extent = edit.sourceExtent ?? sourceExtent(edit.orientation, edit.crop);
  const output = imageSize({
    width: roundCropExtent(size.width, extent.width),
    height: roundCropExtent(size.height, extent.height),
  });
  return edit.orientation >= 5 ? { width: output.height, height: output.width } : output;
}

export const ASPECT_RATIOS = Object.freeze({
  "1:1": 1,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
  "16:9": 16 / 9,
  "3:4": 3 / 4,
  "2:3": 2 / 3,
  "9:16": 9 / 16,
});
export type AspectRatioPreset = keyof typeof ASPECT_RATIOS | "original";

/** Largest centered crop with the preset's physical aspect ratio. Pass the currently
 * visible image dimensions; returned bounds can be used as a sequential crop edit. */
export function aspectRatioCrop(visibleSize: unknown, preset: unknown): CropRect {
  const { width, height } = imageSize(visibleSize);
  requireTransform(
    typeof preset === "string" && (preset === "original" || Object.hasOwn(ASPECT_RATIOS, preset)),
    "invalid-aspect-ratio",
  );
  if (preset === "original") return { left: 0, top: 0, right: 1, bottom: 1 };
  const target = ASPECT_RATIOS[preset as keyof typeof ASPECT_RATIOS];
  const ratio = width / height;
  const w = Math.min(1, target / ratio);
  const h = Math.min(1, ratio / target);
  return cropRect({ left: (1 - w) / 2, top: (1 - h) / 2, right: (1 + w) / 2, bottom: (1 + h) / 2 });
}
