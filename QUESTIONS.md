<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PHO-L2 conservative interpretations

1. **Input and absence contract** (10-pure-libraries-2; PHO-L2 task): the brief names JPEG APP1
   Exif but does not define an API or require standalone TIFF files. Options: accept JPEG only,
   or also detect raw TIFF and other image containers. Implemented JPEG-only `parseExif` over
   `Uint8Array | ArrayBuffer`; return `null` for a structurally readable header with no Exif,
   `{}` for a valid empty Exif directory, and throw `ExifError` for unsupported/malformed input.
2. **Dates and dimensions** (07 Photos, data mapping; PHO-L2 task): options are to infer a timezone
   and derive a `Date`, or preserve the civil timestamp and separate optional offset. Implemented
   the latter; no timezone is invented. ExifIFD dimensions take precedence over IFD0 dimensions,
   before orientation; thumbnail IFDs never supply primary metadata.
3. **Partial/unsupported metadata** (10-pure-libraries-2 fail-closed rule): options are to discard
   bad values or reject. Implemented rejection for malformed requested tags, incomplete GPS pairs,
   duplicate tags/Exif blocks, unsupported TIFF field types, invalid dates/offsets and IFD cycles
   or overlaps. Unrequested tags with TIFF 6 field types are ignored after storage-bounds checks.
   Only IFD0's Exif/GPS pointers and next-IFD chains are followed; private embedded formats are
   outside the requested surface. Header scanning stops at SOS/EOI; image decoding is out of scope.

These choices allow implementation to proceed; no blocking question remains.
