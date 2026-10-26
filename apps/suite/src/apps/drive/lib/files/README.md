<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Drive file utilities (DRV-L2)

Import from `index.ts`. These are synchronous, pure helpers with no storage calls.
Failures use `FileError` with a stable `code`; error messages omit input values.

- `uploadFileName(input)` returns an NFC display name under Drive §4.1.3: replace
  `/ \\ : # ? % *` and Unicode control characters with `-`, trim, cap at 180 Unicode
  code points. Case, spaces, and other punctuation survive. Empty names, dot path
  segments, and malformed Unicode throw. This is upload sanitization, not rename
  validation or a URL decoder.
- `encodeResourceName(input)` applies that policy, then `encodeURIComponent` once
  to produce one LDP slug/path segment. Do not pass an already encoded segment.
- `extensionChain(name)` returns the suffix starting at the first non-leading dot;
  `withSuffix(name, n)` inserts a positive integer ` (n)` before that chain.
  Truncation shortens the stem only; an extension/suffix that cannot fit with at
  least one stem character throws `name-too-long`.
- `renameOnConflict(input, existingNames)` returns the sanitized name when free,
  otherwise the first free ` (1)`, ` (2)`, … name. Existing names are decoded display
  names compared case-sensitively after NFC only. Neither input is mutated. A
  returned name is a suggestion; callers still need a conditional server write.
- `guessContentType(name)` uses a case-insensitive extension table, returning
  `undefined` for an unknown extension. Pass a filename, never a URL or path.
- `sniffContentType(bytes)` recognizes PNG, JPEG, GIF, WebP, PDF, ZIP, MP3 headers,
  supported MP4 `ftyp` brands, and strict UTF-8 text (BOM allowed; controls other than
  tab/CR/LF rejected). It returns `undefined` for empty/unidentified bytes. These
  are signatures, not full-file validation. MP4 needs the complete ordinary-size
  `ftyp` box; extended-size boxes and other brands are outside this subset. M4A/B
  brands return `audio/mp4`; generic MP4 brands return `video/mp4`.
- `detectContentType(name, bytes?)` uses recognized binary magic first, then the
  extension, then generic UTF-8 text, then `application/octet-stream`. Text content
  alone never selects HTML/SVG/RDF or another active/structured format. An extension
  remains a filename hint when bytes cannot identify the format. MIME detection is
  not a security/content-validation boundary; ZIP-based Office files sniff as ZIP.
- `breadcrumbs(current, root)` returns relative `{ label, url }` segments with
  decoded labels and encoded absolute container URLs; root itself returns `[]`.
  Callers provide root UI copy. Both IRIs must be absolute HTTP(S), end with `/`,
  and have no credentials/query/fragment. Traversal, malformed escapes/Unicode,
  control characters, encoded separators, and empty interior segments throw
  `invalid-iri`. Siblings, ancestors, and different origins throw `outside-root`.
  Encoded path spellings are compared exactly; an equivalent but differently
  encoded root prefix is conservatively rejected. No NFC conversion changes an
  existing container's identity.
- `formatFileSize(bytes, locale = "en")` formats nonnegative safe-integer byte
  counts with decimal SI units B–PB and at most one decimal using `Intl`. Unsupported
  or malformed locales throw; pass the account locale for display. Folder placeholders
  and unknown sizes belong to the caller.

See root `QUESTIONS.md` for the conservative readings of unspecified details.
`apps/suite/vitest.config.ts` enforces 100% of statements, branches, functions, and
lines for every TypeScript file in this directory.
