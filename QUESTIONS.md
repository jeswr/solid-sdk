<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DOC-L3 interpretation questions

1. **Projection and position units** (11-pure-libraries-3.md, DOC-L3; 05-docs §4.8/§4.10):
   separators and offsets are unspecified. Options are editor-specific UTF-16 positions or
   Unicode code point positions. Use code points to match the existing Docs anchoring library;
   node paths are arrays of `content` indexes from the document root. Preserve text exactly,
   join blocks/rows with one newline and table cells with one tab, and represent hard breaks
   with newlines. Map generated separators explicitly to their container, without inventing
   a text-node position. Images and horizontal rules are empty blocks; image metadata and list
   markers are not document text. Include empty-node ranges and no trailing generated newline.

2. **Outline anchors and hierarchy** (05-docs §2.2/§4.10; DOC-L3): options include ASCII-only
   slugs or Unicode-preserving slugs, and invented intermediate headings or nearest preceding
   lower-level parents. Use H1–H3 only, nearest preceding lower-level parents, NFKD accent-folded
   lowercase Unicode letters/numbers joined by hyphens, `section` for empty slugs, and globally
   unique suffixes `-1`, `-2`, etc. Determinism applies to the same heading sequence; persistent
   identity across title edits is outside this pure JSON projection.

3. **Statistics** (05-docs §4.10; DOC-L3): options include UTF-16 units, code points, or graphemes
   for characters, and rounded or fractional minutes. Count graphemes and word-like segments
   through `Intl.Segmenter`, using explicit locale `en` by default. Character counts include
   projection whitespace; the without-spaces count excludes Unicode whitespace (including
   separators). Expose exact `words / 230` minutes so presentation can choose rounding. Reject
   unsupported locales or a missing Segmenter instead of substituting heuristics.

4. **Supported JSON schema** (05-docs §1/§8.2; DOC-L3 fail-closed rule): options are a generic
   recursive text walk or the first-cut editor node set. Support the listed document, text,
   paragraph, H1–H3, list/task, quote, code, rule, image, break, and table nodes with valid
   structural nesting. Reject unknown node/mark types and malformed JSON or nesting. Formatting
   attributes/known marks do not affect plain text. Apply bounded input limits and typed errors.
