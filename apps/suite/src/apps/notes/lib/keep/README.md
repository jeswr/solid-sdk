<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Google Keep Takeout drafts

`parseKeepNote(json: string)` parses one serialized note object and returns
`{ draft, warnings }`. `draft.body` is either `{ kind: "text", text }` or
`{ kind: "checklist", items: [{ text, checked }] }`. Lists win even when empty;
the displaced `textContent` is retained in a `TEXT_CONTENT_IGNORED` warning.
`textContentHtml` is type-checked then ignored, including for HTML-only notes.
Text and checklist whitespace is preserved. Nothing renders HTML, reads an
attachment, fetches a link, or writes to storage.

Omitted title/text/arrays default to empty, flags to false, colour to DEFAULT;
absent timestamps stay absent. Labels are trimmed, deduplicated with
`toLowerCase()`, and retain the first trimmed spelling and input order,
including one empty label. `colour` retains the recognized uppercase Keep
enum name. Unknown names produce DEFAULT and an `UNKNOWN_COLOR` warning.

Timestamps accept integer JSON tokens or decimal integer strings. A lexical
pass preserves numeric timestamp digits before JSON decoding, including escaped
property names; conversion uses BigInt. Exact microseconds must lie within
±8,640,000,000,000,000,000. ISO output truncates submillisecond precision toward
zero. Fractional/exponent spellings and malformed strings are rejected rather
than rounded. Boolean/null/array/object timestamps are wrong field types.

Annotation `url` is required; `title`, `description`, and `source` are optional
strings and remain plain text. Only valid absolute http(s) URLs without literal
whitespace, controls, or backslashes survive. Other destinations produce an
`UNSAFE_ANNOTATION_URL` warning. Accepted URLs retain their original spelling.
Attachment `filePath` and `mimetype` are required strings. Paths must be nonempty,
relative filesystem references with no leading slash/backslash, URI/drive
prefix, control characters, or `..` segment (either separator). References are
preserved without normalization or URL decoding; consumers must not treat them
as encoded URLs. No attachment content or MIME type is inferred.

`parseKeepBatch([{ fileName, json }])` returns one ordered result per input
entry: `{ index, fileName, ok: true, draft, warnings }` or
`{ index, fileName?, ok: false, error }`. Duplicate names are retained. Invalid
descriptors, sparse entries, and parsing failures are isolated; filename is
absent if it could not be validated. An invalid batch or a batch exceeding its
limit throws before entry access. Input objects/arrays are never modified.

All failures use `KeepImportError` with a machine-readable `code`; exception
messages contain no note content. Warnings intentionally contain their source
values for the importing caller to review, and must be handled as private text.

| Constant | Inclusive limit | Error on overflow |
| --- | --- | --- |
| `MAX_KEEP_NOTE_BYTES` | 1,048,576 UTF-8 bytes | `NOTE_TOO_LARGE` |
| `MAX_KEEP_LIST_ITEMS` | 2,000 raw items | `INVALID_KEEP_NOTE` |
| `MAX_KEEP_LABELS` | 200 raw labels, before deduplication | `INVALID_KEEP_NOTE` |
| `MAX_KEEP_BATCH_FILES` | 10,000 files | `BATCH_TOO_LARGE` |

Byte counting stops at the limit before JSON parsing. After decoding, both
collection lengths are checked before validating/copying entries; batch length
is checked before iterating files. Nonobject/malformed JSON, wrong field types,
unknown fields, and malformed Unicode fail with `INVALID_KEEP_NOTE`.
Invalid/out-of-range timestamps use `INVALID_TIMESTAMP`; unsafe attachment
references use `UNSAFE_ATTACHMENT_PATH`. Unsupported fields are rejected at
every object level. These are plain TypeScript helpers with no dependencies.
