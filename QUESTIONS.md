<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ssm2 / DOC-L1

1. What offset and projection contract should DOC-L1 expose? (05-docs §7.2;
   09-pure-libraries.) Options: DOM/UTF-16 offsets with projection inside this library,
   or Unicode code point offsets into caller-supplied plain text. Conservative choice:
   Unicode code points, start inclusive/end exclusive, per W3C Web Annotation
   [§4.2.4–5](https://www.w3.org/TR/annotation-model/#text-quote-selector).
   The caller supplies a consistent plain-text projection; no HTML parsing, whitespace
   collapsing or Unicode normalization is performed here. Non-empty selections only.

2. What fuzzy bounds and confidence formula should DOC-L1 use? (05-docs §7.2;
   DOC-L1 task description.) Options: unbounded searching or explicit finite bounds.
   Conservative choice: default minimum confidence 0.5 (the spec's threshold),
   confidence = 1 − Levenshtein edits / original quote code point length, at most 32
   edits, candidate starts within 1,024 code points of the old position (clamped to
   the current document). Callers can reduce the edit limit or change the radius up
   to 4,096. Exact quote search always covers the whole document. Context agreement,
   then distance to the old start, then earliest start/end break equal-confidence
   ties. Identical text at the original position is accepted first as requested.
   No external matcher dependency is needed. These are implementation defaults,
   exposed and documented for the consuming DOC-09 task to review.
