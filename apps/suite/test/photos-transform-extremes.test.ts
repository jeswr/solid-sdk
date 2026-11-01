// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  composeEdits,
  computeOutputSize,
  createEditRecord,
  MAX_SOURCE_DIMENSION,
  type PhotoEdit,
  type PhotoEditRecord,
  TransformError,
} from "../src/apps/photos/lib/transform";

const full = { left: 0, top: 0, right: 1, bottom: 1 };
const horizontal: PhotoEdit = { type: "flip", axis: "horizontal" };
const vertical: PhotoEdit = { type: "flip", axis: "vertical" };
const rotate = (degrees: number): PhotoEdit => ({ type: "rotate", degrees });
const sequences: PhotoEdit[][] = [
  [horizontal, horizontal],
  [vertical, vertical],
  ...[0, 90, -90, 180, -180, 270, -270, 360, -360, 450, -450, 720, -720].map((degrees) => [
    rotate(degrees),
    rotate(-degrees),
  ]),
  Array.from({ length: 4 }, () => rotate(90)),
  Array.from({ length: 4 }, () => rotate(-90)),
  [rotate(180), rotate(180)],
  [horizontal, rotate(-90), vertical, vertical, rotate(90), horizontal],
];

function restored(record: PhotoEditRecord): PhotoEditRecord {
  return JSON.parse(JSON.stringify(record));
}

describe("source extents survive reversible orientation edits", () => {
  it("preserves the review's 12 by 3 crop through flips and negative rotations", () => {
    const source = { width: 10_000_000, height: 3 };
    const initial = { orientation: 1, crop: { ...full, left: 0.3, right: 0.30000115 } };
    expect(computeOutputSize(source, initial)).toEqual({ width: 12, height: 3 });
    const flipped = composeEdits(initial, [horizontal]);
    expect(computeOutputSize(source, flipped)).toEqual({ width: 12, height: 3 });
    expect(computeOutputSize(source, composeEdits(restored(flipped), [horizontal]))).toEqual({
      width: 12,
      height: 3,
    });
    expect(computeOutputSize(source, composeEdits(initial, [rotate(-90)]))).toEqual({
      width: 3,
      height: 12,
    });
  });

  it.each([
    { width: 10_000_000, height: 3 },
    { width: 3, height: 10_000_000 },
    { width: MAX_SOURCE_DIMENSION, height: 3 },
    { width: 3, height: MAX_SOURCE_DIMENSION },
    { width: MAX_SOURCE_DIMENSION, height: MAX_SOURCE_DIMENSION },
  ])("keeps near-threshold crops at $width by $height across every EXIF state", (source) => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const width = orientation < 5 ? source.width : source.height;
      const height = orientation < 5 ? source.height : source.width;
      for (const inset of [0, 0.001, 0.125, 0.3, 0.5]) {
        for (const offset of [-1e-8, -1e-10, 0, 1e-10, 1e-8, -0.25, 0.25]) {
          const initial = composeEdits(createEditRecord(orientation), [
            {
              type: "crop",
              rect: {
                left: inset,
                top: inset,
                right: inset + (width === 3 ? 1.5 : 11.5 + offset) / width,
                bottom: inset + (height === 3 ? 1.5 : 17.5 + offset) / height,
              },
            },
          ]);
          const output = computeOutputSize(source, initial);
          for (const edits of sequences) {
            let current = restored(initial);
            let expected = output;
            for (const edit of edits) {
              if (edit.type === "rotate" && edit.degrees % 180 !== 0) {
                expected = { width: expected.height, height: expected.width };
              }
              current = composeEdits(restored(current), [edit]);
              expect(computeOutputSize(source, current)).toEqual(expected);
            }
            expect(current.orientation).toBe(initial.orientation);
            expect(computeOutputSize(source, current)).toEqual(output);
            expect(computeOutputSize(source, composeEdits(initial, edits))).toEqual(output);
          }
        }
      }
    }
  });

  it("keeps a half-pixel crop nonempty at the dimension limit", () => {
    const source = { width: MAX_SOURCE_DIMENSION, height: MAX_SOURCE_DIMENSION };
    for (const inset of [0, 0.1, 0.5]) {
      const edge = inset + 0.5 / MAX_SOURCE_DIMENSION;
      const initial = {
        orientation: 1,
        crop: { left: inset, top: inset, right: edge, bottom: edge },
      };
      expect(computeOutputSize(source, initial)).toEqual({ width: 1, height: 1 });
      for (const edits of sequences) {
        let current = composeEdits(initial, edits);
        current = composeEdits(restored(current), [{ type: "crop", rect: full }]);
        expect(computeOutputSize(source, current)).toEqual({ width: 1, height: 1 });
      }
    }
  });

  it("uses the retained source geometry for subsequent crops and copies saved metadata", () => {
    const source = { width: 10_000_000, height: 3 };
    const initial = { orientation: 1, crop: { ...full, left: 0.3, right: 0.30000115 } };
    const changed = composeEdits(initial, [horizontal, rotate(-90)]);
    expect(changed.sourceExtent).toEqual({
      width: initial.crop.right - initial.crop.left,
      height: 1,
    });
    const saved = JSON.stringify(changed);
    const copy = composeEdits(changed, []);
    expect(copy.sourceExtent).not.toBe(changed.sourceExtent);
    expect(JSON.stringify(changed)).toBe(saved);
    const cropped = composeEdits(restored(changed), [
      { type: "crop", rect: { ...full, bottom: 0.5 } },
    ]);
    expect(computeOutputSize(source, cropped)).toEqual({ width: 3, height: 6 });
    expect(computeOutputSize(source, composeEdits(restored(cropped), [rotate(90)]))).toEqual({
      width: 6,
      height: 3,
    });
    expect(JSON.stringify(changed)).toBe(saved);
  });

  it("retains source extents through repeated crops interleaved with orientation edits", () => {
    const source = { width: MAX_SOURCE_DIMENSION, height: MAX_SOURCE_DIMENSION - 31 };
    let current = createEditRecord();
    for (let step = 0; step < 50; step++) {
      current = composeEdits(restored(current), [
        { type: "crop", rect: { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95 } },
      ]);
      const output = computeOutputSize(source, current);
      current = composeEdits(restored(current), [rotate(-90), horizontal]);
      expect(computeOutputSize(source, current)).toEqual({
        width: output.height,
        height: output.width,
      });
      current = composeEdits(restored(current), [horizontal, rotate(90)]);
      expect(computeOutputSize(source, current)).toEqual(output);
    }
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { width: 1 },
    { width: 1, height: 1, extra: true },
    { width: "1", height: 1 },
    { width: NaN, height: 1 },
    { width: Infinity, height: 1 },
    { width: 0, height: 1 },
    { width: -1, height: 1 },
    { width: 1.01, height: 1 },
    { width: 1, height: 0 },
    { width: 1, height: 1.01 },
  ])("rejects malformed saved source extents %j", (sourceExtent) => {
    const record = { ...createEditRecord(), sourceExtent };
    for (const run of [
      () => composeEdits(record, []),
      () => computeOutputSize({ width: 10_000_000, height: 3 }, record),
    ]) {
      expect(run).toThrow(TransformError);
      expect(run).toThrow(expect.objectContaining({ code: "invalid-record" }));
    }
  });
});
