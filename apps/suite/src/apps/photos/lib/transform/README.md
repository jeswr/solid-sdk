<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Photo transforms

Pure synchronous helpers compose EXIF orientation, quarter-turn rotations, display-axis flips,
and normalized crops into one JSON-compatible `PhotoEditRecord`. Crops select bounds within
the currently visible crop. Inputs are validated and never mutated; invalid records, edits,
sizes, crops, orientations, and aspect presets throw `TransformError` with a typed `code`.
`ASPECT_RATIOS` exports the supported fixed presets; `"original"` keeps the visible aspect.

`computeOutputSize` calculates each continuous crop extent on the original, unreflected and
unrotated source axes, rounds it to the nearest integer pixel, then applies orientation only
by swapping width and height for quarter-turns. Flips, rotations, and sequences returning to
identity therefore preserve the same two output dimensions. Half-pixel ties round up.
A value within `min(sourceAxisPixels * Number.EPSILON, 1e-9)` pixels below a half-pixel
threshold counts as a tie for arithmetic error; values farther below it round down.
For example, a 1000×3000 source cropped to
`{ left: 0.001, top: 0, right: 0.4015, bottom: 1 }` exports at 401×3000 before a horizontal flip,
after it, and after flipping back. A 10000000×3 source cropped to
`{ left: 0.3, top: 0, right: 0.30000115, bottom: 1 }` likewise stays 12×3, or 3×12 after a
quarter-turn, including −90°.

The display-frame `crop` bounds still select the content to render. When those bounds cannot
reproduce the source extents exactly, `composeEdits` also saves `sourceExtent: { width, height }`
in the record. These are normalized fractions on the original source axes, not pixel sizes.
Keep this optional field when serializing or copying records; JSON round-trips preserve it.
Legacy records without it derive their source extents once from their existing bounds.
Orientation edits retain those extents; subsequent crops scale them by the selected fractions
on the corresponding source axes. These saved extents are authoritative for output sizing;
re-deriving them from display bounds would reintroduce floating-point drift, including after
repeated crops. Saved extents must be finite, positive, and at most one; invalid metadata
throws `invalid-record`.

Source dimensions must be positive integers no larger than the exported
`MAX_SOURCE_DIMENSION` (`2 ** 50`, or 1125899906842624 pixels per axis). Larger dimensions throw
`TransformError` with code `invalid-size` in both `computeOutputSize` and `aspectRatioCrop`.
This bound keeps half a source pixel wider than the floating-point precision lost when
reflecting normalized bounds, so a pixel-producing crop cannot collapse during an orientation
edit. Previously accepted larger safe integers cannot satisfy that guarantee.
Crop bounds must be finite, ordered, and within `[0, 1]`.
Output dimensions that round below one pixel throw `invalid-size`;
they are never clamped or upscaled. Crop bounds that collapse at floating-point precision
throw `invalid-crop`.

`pnpm --filter @jeswr/app-suite run test` enforces 100% statements, branches, functions,
and lines per TypeScript file in this directory.
