<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DOC-L6 conservative interpretations

1. **Edit coordinates and undo** (DOC-L6 task; 14-pure-libraries-6): the brief does
   not specify whether `textBefore` includes the typed character. Options are
   pre-insertion or post-insertion coordinates. Use `textBefore` excluding the
   character, then return UTF-16 `[from, to)` coordinates into `textBefore + typed`.
   `original` is the exact replaced substring, including the typed character when
   replaced. Undo replaces `[from, from + insert.length)` with `original`.
2. **Fraction right boundary** (DOC-L6 task): converting on the denominator treats
   the caret as an end boundary, which could convert the prefix of `1/20`.
   Alternatively, wait for a non-digit. Choose the latter: `1/2` plus typed space
   becomes `½ `; typing the `2` alone does not convert. Preserve the delimiter.
   Start of the supplied block counts as a left boundary; a truncated window's
   start does not. Digits mean Unicode decimal digits.
3. **Window versus rejection** (DOC-L6 task and acceptance; 14-pure-libraries-6):
   the task explicitly accepts input longer than 512, while the generic acceptance
   asks for rejection at bound+1. Preserve the explicit truncation contract:
   512 and 513 UTF-16 units are accepted, with matching restricted to the last 512
   units before typing. Check lengths before scanning or copying input; validate
   all original text for lone surrogates, including the discarded prefix, to meet
   `INVALID_TEXT`. Only this validation scales with full block length. Never
   treat a surrogate pair cut by the window as malformed input.
4. **Rule ids and quote contexts** (DOC-L6 task): no ids are prescribed. Export one
   id for each individual replacement (including separate single/double quotes)
   so each can be disabled independently. Opening brackets use Unicode opening
   punctuation, and dashes use Unicode dash punctuation. Quote direction depends
   on the preceding character; after letters a single quote is always closing.
   A missing predecessor at a truncated window boundary is insufficient context,
   so no context-dependent replacement fires there.
