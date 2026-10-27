<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Photo transforms

Pure synchronous helpers compose EXIF orientation, quarter-turn rotations, display-axis flips,
and normalized crops into one JSON-compatible `PhotoEditRecord`. Crops select bounds within
the currently visible crop. Inputs are validated and never mutated; invalid records, edits,
sizes, crops, orientations, and aspect presets throw `TransformError` with a typed `code`.
`ASPECT_RATIOS` exports the supported fixed presets; `"original"` keeps the visible aspect.

`computeOutputSize` uses the oriented source dimensions and rounds each continuous crop extent
to the nearest integer pixel, with half-pixel ties rounded up. Extents are calculated from
complemented bounds, `(1 - start) - (1 - end)`, so reflections and their inverses use the same
floating-point grid. If complementing makes distinct bounds coincide, the original difference
`end - start` preserves the narrow crop's extent. A value within
`sourceAxisPixels * Number.EPSILON` below a half-pixel
threshold counts as a tie, accounting for normalized-bound remapping and multiplication error.
Values farther below the threshold round down. For example, a 1000×3000 source cropped to
`{ left: 0.001, top: 0, right: 0.4015, bottom: 1 }` exports at 401×3000 before a horizontal flip,
after it, and after flipping back. Quarter-turns exchange output width and height.

Source dimensions must be positive safe integers, and crop bounds must be finite, ordered,
and within `[0, 1]`. Output dimensions that round below one pixel throw `invalid-size`;
they are never clamped or upscaled. Crop bounds that collapse at floating-point precision
throw `invalid-crop`.

`pnpm --filter @jeswr/app-suite run test` enforces 100% statements, branches, functions,
and lines per TypeScript file in this directory.
