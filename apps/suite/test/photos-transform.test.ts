// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  aspectRatioCrop,
  type CropRect,
  composeEdits,
  computeOutputSize,
  createEditRecord,
  orientationMatrix,
  type PhotoEdit,
  TransformError,
  type TransformErrorCode,
} from "../src/apps/photos/lib/transform";

const full = { left: 0, top: 0, right: 1, bottom: 1 };
const crop = { left: 0.125, top: 0.25, right: 0.625, bottom: 0.875 };
const size = { width: 4000, height: 3000 };
const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;
const expectedCorners = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  [
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 1],
    [0, 1],
    [0, 0],
    [1, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ],
  [
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
  [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ],
  [
    [0, 1],
    [0, 0],
    [1, 0],
    [1, 1],
  ],
];
function fails(run: () => unknown, code: TransformErrorCode) {
  expect(run).toThrow(TransformError);
  expect(run).toThrow(expect.objectContaining({ name: "TransformError", code }));
}
function cropped(rect: CropRect = crop) {
  return composeEdits(createEditRecord(), [{ type: "crop", rect }]);
}

describe("EXIF normalization", () => {
  it("maps all four corners for each EXIF orientation", () => {
    for (let i = 1; i <= 8; i++) {
      const [a, b, c, d, e, f] = orientationMatrix(i);
      expect(corners.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])).toEqual(
        expectedCorners[i - 1],
      );
      expect(createEditRecord(i)).toEqual({ orientation: i, crop: full });
      expect(computeOutputSize(size, createEditRecord(i))).toEqual(
        i < 5 ? size : { width: 3000, height: 4000 },
      );
    }
    expect(createEditRecord()).toEqual({ orientation: 1, crop: full });
  });
  it("returns independent matrices and rejects invalid saved orientations", () => {
    const matrix = orientationMatrix(1);
    Reflect.set(matrix, "0", 100);
    expect(orientationMatrix(1)[0]).toBe(1);
    fails(() => composeEdits({ orientation: 9, crop: full }, []), "invalid-orientation");
  });
  it.each([0, 9, -1, 1.5, NaN, Infinity, "6", null, {}, []])("rejects orientation %j", (value) => {
    fails(() => orientationMatrix(value), "invalid-orientation");
    fails(() => createEditRecord(value), "invalid-orientation");
  });
});

describe("sequential non-destructive edits", () => {
  it("composes nested crops without mutating or sharing caller objects", () => {
    const initial = createEditRecord();
    const before = JSON.stringify(initial);
    const edits: PhotoEdit[] = [
      { type: "crop", rect: crop },
      { type: "crop", rect: crop },
    ];
    const result = composeEdits(initial, edits);
    expect(result.crop).toEqual({ left: 0.1875, top: 0.40625, right: 0.4375, bottom: 0.796875 });
    expect(JSON.stringify(initial)).toBe(before);
    expect(crop).toEqual({ left: 0.125, top: 0.25, right: 0.625, bottom: 0.875 });
    expect(composeEdits(initial, [])).toEqual(initial);
    expect(composeEdits(initial, []).crop).not.toBe(initial.crop);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(computeOutputSize(size, result)).toEqual({ width: 1000, height: 1172 });
  });
  it("remaps an asymmetric crop with clockwise rotations and display-axis flips", () => {
    expect(composeEdits(cropped(), [{ type: "rotate", degrees: 90 }])).toEqual({
      orientation: 6,
      crop: { left: 0.125, top: 0.125, right: 0.75, bottom: 0.625 },
    });
    expect(composeEdits(cropped(), [{ type: "flip", axis: "horizontal" }])).toEqual({
      orientation: 2,
      crop: { left: 0.375, top: 0.25, right: 0.875, bottom: 0.875 },
    });
    expect(composeEdits(cropped(), [{ type: "flip", axis: "vertical" }])).toEqual({
      orientation: 4,
      crop: { left: 0.125, top: 0.125, right: 0.625, bottom: 0.75 },
    });
    expect(
      computeOutputSize(size, composeEdits(cropped(), [{ type: "rotate", degrees: -90 }])),
    ).toEqual({ width: 1875, height: 2000 });
  });
  it("preserves selected content and composes matrices for every EXIF state", () => {
    for (let i = 1; i <= 8; i++) {
      const initial = composeEdits(createEditRecord(i), [{ type: "crop", rect: crop }]);
      for (const edit of [
        { type: "rotate", degrees: 90 },
        { type: "flip", axis: "horizontal" },
        { type: "flip", axis: "vertical" },
      ] satisfies PhotoEdit[]) {
        const result = composeEdits(initial, [edit]);
        const [a, b, c, d, e, f] = orientationMatrix(i);
        const [aa, bb, cc, dd, ee, ff] = orientationMatrix(result.orientation);
        for (const [x, y] of corners) {
          const u = a * x + c * y + e;
          const v = b * x + d * y + f;
          const expected =
            edit.type === "rotate"
              ? [1 - v, u]
              : edit.axis === "horizontal"
                ? [1 - u, v]
                : [u, 1 - v];
          expect([aa * x + cc * y + ee, bb * x + dd * y + ff]).toEqual(expected);
        }
        const count = edit.type === "rotate" ? 4 : 2;
        expect(
          composeEdits(
            initial,
            Array.from({ length: count }, () => edit),
          ),
        ).toEqual(initial);
        const output = computeOutputSize(size, initial);
        expect(computeOutputSize(size, result)).toEqual(
          edit.type === "rotate" ? { width: output.height, height: output.width } : output,
        );
      }
      for (const degrees of [0, 360, -360, 720]) {
        expect(composeEdits(initial, [{ type: "rotate", degrees }])).toEqual(initial);
      }
      expect(composeEdits(initial, [{ type: "rotate", degrees: -90 }])).toEqual(
        composeEdits(initial, [{ type: "rotate", degrees: 270 }]),
      );
    }
  });
  it("keeps operation order and supports further edits after JSON round-trip", () => {
    const steps: PhotoEdit[] = [
      { type: "flip", axis: "horizontal" },
      { type: "rotate", degrees: 90 },
      { type: "crop", rect: crop },
      { type: "flip", axis: "vertical" },
    ];
    const record = createEditRecord(7);
    const result = steps.reduce(
      (state, edit) => composeEdits(JSON.parse(JSON.stringify(state)), [edit]),
      record,
    );
    expect(result).toEqual(composeEdits(record, steps));
    expect(composeEdits(record, steps.slice(0, 2)).orientation).not.toBe(
      composeEdits(record, steps.slice(0, 2).reverse()).orientation,
    );
  });
  it("interprets a crop after rotation in the visible frame and leaves failed batches atomic", () => {
    const source = createEditRecord(6);
    expect(composeEdits(source, [{ type: "crop", rect: crop }])).toEqual({
      orientation: 6,
      crop,
    });
    expect(computeOutputSize(size, composeEdits(source, [{ type: "crop", rect: crop }]))).toEqual({
      width: 1500,
      height: 2500,
    });
    fails(
      () =>
        composeEdits(source, [
          { type: "crop", rect: crop },
          { type: "rotate", degrees: 45 },
        ]),
      "invalid-edit",
    );
    expect(source).toEqual(createEditRecord(6));
  });
  it("retains valid fractional boundary crops through repeated transforms", () => {
    let record = cropped({ left: 0.1, top: 0, right: 1, bottom: 0.3 });
    for (let i = 0; i < 100; i++) {
      record = composeEdits(record, [
        { type: "rotate", degrees: 90 },
        { type: "flip", axis: "horizontal" },
      ]);
      expect(record.crop.left).toBeGreaterThanOrEqual(0);
      expect(record.crop.top).toBeGreaterThanOrEqual(0);
      expect(record.crop.right).toBeLessThanOrEqual(1);
      expect(record.crop.bottom).toBeLessThanOrEqual(1);
    }
  });
});

describe("aspect presets and output pixels", () => {
  it("keeps the 401-pixel fractional crop through a horizontal flip and its inverse", () => {
    const source = { width: 1000, height: 3000 };
    const initial = cropped({ left: 0.001, top: 0, right: 0.4015, bottom: 1 });
    const flip: PhotoEdit = { type: "flip", axis: "horizontal" };
    const flipped = composeEdits(initial, [flip]);
    const restored = composeEdits(JSON.parse(JSON.stringify(flipped)), [flip]);
    for (const record of [initial, flipped, restored]) {
      expect(computeOutputSize(source, record)).toEqual({ width: 401, height: 3000 });
    }
  });
  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])("keeps half-pixel extents through reversible edits from orientation %i", (orientation) => {
    const source = { width: 1000, height: 3000 };
    const width = orientation < 5 ? source.width : source.height;
    const height = orientation < 5 ? source.height : source.width;
    const pairs: [PhotoEdit, PhotoEdit, boolean][] = [
      [{ type: "flip", axis: "horizontal" }, { type: "flip", axis: "horizontal" }, false],
      [{ type: "flip", axis: "vertical" }, { type: "flip", axis: "vertical" }, false],
      [{ type: "rotate", degrees: 90 }, { type: "rotate", degrees: -90 }, true],
      [{ type: "rotate", degrees: -90 }, { type: "rotate", degrees: 90 }, true],
      [{ type: "rotate", degrees: 180 }, { type: "rotate", degrees: -180 }, false],
      [{ type: "rotate", degrees: 270 }, { type: "rotate", degrees: -270 }, true],
    ];
    for (const inset of [0.001, 0.125, 0.5]) {
      for (const pixels of [0, 1, 17, 400]) {
        const deltas = [
          -1e-8,
          -1e-10,
          ...[-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4].map((factor) => factor * Number.EPSILON * width),
          1e-10,
          1e-8,
        ];
        for (const delta of deltas) {
          const initial = composeEdits(createEditRecord(orientation), [
            {
              type: "crop",
              rect: {
                left: inset,
                top: inset,
                right: inset + (pixels + 0.5 + delta) / width,
                bottom: inset + (pixels + 17.5 + delta) / height,
              },
            },
          ]);
          // Crops just below half a pixel still fail with the existing typed error.
          if (pixels === 0 && delta <= -1e-10) {
            fails(() => computeOutputSize(source, initial), "invalid-size");
            continue;
          }
          // Near zero, a negative rounding offset may also be outside the tolerance.
          if (pixels === 0 && delta < 0) continue;
          const output = computeOutputSize(source, initial);
          if (Math.abs(delta) >= 1e-10 || delta === 0) {
            const expected = pixels + (delta < 0 ? 0 : 1);
            expect(output).toEqual({ width: expected, height: expected + 17 });
          }
          for (const [edit, inverse, swaps] of pairs) {
            const changed = composeEdits(initial, [edit]);
            expect(computeOutputSize(source, changed)).toEqual(
              swaps ? { width: output.height, height: output.width } : output,
            );
            const restored = composeEdits(JSON.parse(JSON.stringify(changed)), [inverse]);
            expect(restored.orientation).toBe(initial.orientation);
            expect(computeOutputSize(source, restored)).toEqual(output);
            expect(computeOutputSize(source, composeEdits(initial, [edit, inverse]))).toEqual(
              output,
            );
          }
        }
      }
    }
  });
  it("fits centered presets inside landscape, portrait and square images", () => {
    expect(aspectRatioCrop(size, "original")).toEqual(full);
    expect(aspectRatioCrop(size, "4:3")).toEqual(full);
    expect(aspectRatioCrop(size, "1:1")).toEqual({ left: 0.125, top: 0, right: 0.875, bottom: 1 });
    expect(aspectRatioCrop(size, "16:9")).toEqual({ left: 0, top: 0.125, right: 1, bottom: 0.875 });
    for (const dimensions of [size, { width: 3000, height: 4000 }, { width: 1000, height: 1000 }]) {
      for (const [preset, ratio] of Object.entries(ASPECT_RATIOS)) {
        const rect = aspectRatioCrop(dimensions, preset);
        expect(rect.left + rect.right).toBeCloseTo(1);
        expect(rect.top + rect.bottom).toBeCloseTo(1);
        expect(
          ((rect.right - rect.left) * dimensions.width) /
            ((rect.bottom - rect.top) * dimensions.height),
        ).toBeCloseTo(ratio);
        const output = computeOutputSize(dimensions, cropped(rect));
        expect(output.width).toBeLessThanOrEqual(dimensions.width);
        expect(output.height).toBeLessThanOrEqual(dimensions.height);
      }
    }
  });
  it("rounds continuous extents and rejects outputs that round below one pixel", () => {
    expect(
      computeOutputSize(
        { width: 3, height: 5 },
        cropped({ left: 0, top: 0, right: 0.5, bottom: 0.5 }),
      ),
    ).toEqual({ width: 2, height: 3 });
    fails(
      () =>
        computeOutputSize(
          { width: 1, height: 1 },
          cropped({ left: 0, top: 0, right: 0.1, bottom: 1 }),
        ),
      "invalid-size",
    );
    fails(
      () =>
        computeOutputSize(
          { width: 1, height: 1 },
          cropped({ left: 0, top: 0, right: 1, bottom: 0.1 }),
        ),
      "invalid-size",
    );
    expect(
      computeOutputSize({ width: Number.MAX_SAFE_INTEGER, height: 1 }, createEditRecord()),
    ).toEqual({ width: Number.MAX_SAFE_INTEGER, height: 1 });
  });
});

describe("fail-closed validation", () => {
  it.each([
    null,
    [],
    "record",
    {},
    { orientation: 1 },
    { orientation: 1, crop: full, version: 2 },
  ])("rejects malformed records %j", (record) => {
    fails(() => composeEdits(record, []), "invalid-record");
    fails(() => computeOutputSize(size, record), "invalid-record");
  });
  it.each([
    null,
    {},
    "edit",
    [null],
    [[]],
    [{}],
    [{ type: "resize" }],
    [{ type: "rotate", degrees: 45 }],
    [{ type: "rotate", degrees: "90" }],
    [{ type: "rotate", degrees: Infinity }],
    [{ type: "rotate", degrees: Number.MAX_VALUE }],
    [{ type: "rotate", degrees: 90, extra: true }],
    [{ type: "flip", axis: "diagonal" }],
    [{ type: "flip", axis: "horizontal", extra: true }],
    [{ type: "crop", rect: full, extra: true }],
  ])("rejects unsupported edits %j", (edits) => {
    fails(() => composeEdits(createEditRecord(), edits), "invalid-edit");
  });
  it("rejects sparse edit lists", () => {
    fails(() => composeEdits(createEditRecord(), Array(1)), "invalid-edit");
  });
  it.each([
    null,
    [],
    {},
    { ...full, left: NaN },
    { ...full, right: Infinity },
    { ...full, left: -0.01 },
    { ...full, right: 1.01 },
    { ...full, top: -1 },
    { ...full, bottom: 2 },
    { ...full, left: 1 },
    { ...full, top: 1 },
    { ...full, right: 0 },
    { ...full, bottom: 0 },
    { ...full, left: "0" },
    { ...full, x: 0 },
  ])("rejects invalid crops %j", (rect) => {
    fails(() => composeEdits(createEditRecord(), [{ type: "crop", rect }]), "invalid-crop");
    fails(() => composeEdits({ orientation: 1, crop: rect }, []), "invalid-crop");
  });
  it("rejects crops that collapse at floating-point precision", () => {
    fails(
      () =>
        composeEdits(
          cropped({ left: 0.5, top: 0.5, right: 0.5000000000000001, bottom: 0.5000000000000001 }),
          [{ type: "crop", rect: { left: 0.1, top: 0.1, right: 0.2, bottom: 0.2 } }],
        ),
      "invalid-crop",
    );
  });
  it.each([
    null,
    [],
    {},
    { width: 1 },
    { width: 0, height: 1 },
    { width: 1, height: 0 },
    { width: -1, height: 1 },
    { width: NaN, height: 1 },
    { width: 1, height: Infinity },
    { width: 1.5, height: 2 },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 1 },
    { width: "2", height: 1 },
    { ...size, extra: true },
  ])("rejects invalid sizes %j", (value) => {
    fails(() => computeOutputSize(value, createEditRecord()), "invalid-size");
    fails(() => aspectRatioCrop(value, "1:1"), "invalid-size");
  });
  it.each([null, 1, "", "free", "toString", "__proto__"])("rejects invalid presets %j", (value) => {
    fails(() => aspectRatioCrop(size, value), "invalid-aspect-ratio");
  });
});
