<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# JPEG Exif reader

```ts
import { ExifError, parseExif } from "./index";

const metadata = parseExif(jpegBytes); // Uint8Array (including subviews) or ArrayBuffer
// null: no Exif in the JPEG header; {}: valid Exif with no requested tags
```

Pure synchronous TypeScript, with no React, fetch, image decoder or third-party dependencies.
Reads TIFF 6 in either byte order inside JPEG APP1 `Exif\0\0`. Tag definitions follow
[CIPA Exif 2.32](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf).

- `dateTimeOriginal` is the validated `YYYY:MM:DD HH:mm:ss` civil time, and
  `offsetTimeOriginal` is the optional signed `HH:mm` offset. Neither timezone nor UTC instant
  is inferred. Invalid/blank/partial dates, leap seconds and malformed offsets are rejected.
- `orientation` is 1–8, including mirrored orientations; `make`/`model` are printable ASCII,
  preserved without trimming. Empty strings are valid; embedded NULs are rejected.
- `width`/`height` are positive stored pixel dimensions, before orientation. ExifIFD's
  PixelXDimension/PixelYDimension take precedence over IFD0's ImageWidth/ImageLength independently.
  Both sources are validated. No dimensions are inferred from JPEG frame headers.
- `gps` contains decimal `latitude`/`longitude` from three unsigned rationals (degrees, minutes,
  seconds) and N/S/E/W references. Zero denominators, invalid ranges and incomplete pairs fail.
  No location is invented from missing references, and zero is returned as positive zero.
- Missing fields stay absent. Unrequested tags are ignored after validating their TIFF field
  type, count and payload extent; opaque values such as MakerNote are not decoded. Only
  IFD0's Exif/GPS pointers and next-IFD chains are followed. Thumbnail directories are checked
  structurally but never used as primary metadata.
- All reads are bounded to the APP1 payload. IFD traversal is iterative; repeated offsets,
  overlapping tables/table payloads, duplicate tags/Exif segments, non-word-aligned external
  offsets and unsupported TIFF types throw `ExifError`. Shared external payloads are allowed.
  Errors expose a typed `code` and never include image bytes or private metadata in their text.
- Input is never mutated; results are fresh. Raw TIFF, BigTIFF and non-JPEG containers are
  rejected. Scanning ends at the first SOS/EOI: this validates metadata storage and header segment
  framing, not JPEG scan contents or full image decodability. Complete image validation belongs
  to the caller's image decoder.

`pnpm --filter @jeswr/app-suite run test` enforces 100% statements, branches, functions and lines
per TypeScript file in this directory. Fixtures are built by the small synthetic writer in
`test/photos-exif.test.ts`; no real photographs or personal metadata are stored.
