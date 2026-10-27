<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# NOT-L4 conservative interpretations

1. NOT-L4 / 14-pure-libraries-6 does not name the API or draft shape. Accept a
   serialized JSON object in `parseKeepNote(json)` so the byte limit and original
   timestamp digits can be enforced; return `{ draft, warnings }`. Use a tagged
   text/checklist body and the existing `{ text, checked }` checklist shape.
   The alternative is accepting already-decoded objects, whose numeric precision
   and original JSON byte size cannot be recovered.
2. NOT-L4 does not specify required top-level fields or omitted defaults. Accept
   omitted fields: empty title/text/arrays, false flags, DEFAULT colour; omit
   absent created/updated timestamps. Present fields must have their declared
   types. Reject unknown fields instead of silently dropping unsupported data
   (except the explicitly ignored string `textContentHtml`). Alternatives are
   requiring every field or ignoring unknown fields. Retain a trimmed empty
   label because the task specifies trimming/deduplication, not dropping labels.
3. NOT-L4 names no separate list/label overflow error codes. Use
   `INVALID_KEEP_NOTE` for both; the alternative is inventing additional codes.
   Validate lengths before item validation, including before deduplication.
4. NOT-L4 requires BigInt-safe microsecond conversion without specifying numeric
   spelling or submillisecond precision. Accept signed integer JSON tokens and
   decimal integer strings; reject fractional/exponent spellings with
   `INVALID_TIMESTAMP` rather than round them. Check the exact microsecond Date
   range before truncating submillisecond precision toward zero, as Date does.
   Preserve accepted URL/path spelling; validate attachment paths as relative
   filesystem references without URL decoding or normalization. Alternatives
   include coercing timestamp spellings or normalizing paths/URLs.
