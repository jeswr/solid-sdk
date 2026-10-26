<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PHO-L5 conservative interpretations

1. `13-pure-libraries-5.md` / PHO-L5 and `07-parity-backlog.md` / Photos do not specify
   arbitrary-angle versus quarter-turn rotation. Options: resample arbitrary angles with a
   crop polygon, or retain rectangular crops with quarter turns. This lane supports signed
   multiples of 90 degrees only; other angles raise a typed error.
2. Those sections do not specify crop coordinates or edit order. Options: source-relative
   replacement crops, or sequential crops relative to the currently visible image. This lane
   composes sequential crops and stores normalized edge bounds in the fully oriented source
   frame. Flips act in display axes. EXIF is applied exactly once at record creation.
3. Those sections do not enumerate aspect presets or pixel rounding. This lane provides
   original, 1:1, 4:3, 3:2, 16:9 and their portrait counterparts, centered without upscaling.
   Output dimensions round the continuous crop extent to the nearest integer pixel; a result
   below one pixel is rejected. Source dimensions must be positive safe integers. Resizing,
   raster decoding/encoding and persistence remain outside this pure transform library.
