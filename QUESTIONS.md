<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PHO-L1 implementation questions

1. **Timeline defaults and missing dates** — `07-parity-backlog.md`, Photos / Timeline,
   and `09-pure-libraries.md` require time zone handling without specifying defaults or
   missing-date policy. Options: implicit device time zone or explicit zone with UTC fallback;
   discard invalid dates, group them separately, or reject them. Conservative reading used:
   UTC by default, newest first, stable ties, `Date` or epoch-millisecond instants only,
   and invalid dates rejected. Callers resolve missing dates before grouping.
2. **Row endings and sizing** — the same sections require justified rows but specify no
   row-selection or last-row policy. Options: greedy or globally optimised breaks; stretch
   or cap the last row. Conservative reading used: preserve input order, greedily close a
   row when its target-height width reaches the container, justify completed rows, and
   cap the remaining row at the caller's target height. Gap defaults to zero; target
   height is explicit. No cropping or integer-pixel rounding.
3. **Duplicate threshold and preprocessing** — PHO-L1 in `tasks.json` and
   `09-pure-libraries.md` specify dHash over injected grayscale pixels without a similarity
   threshold or image decoding policy. Options: decode/resize here or accept a prepared
   sample; infer a threshold or require one. Conservative reading used: accept a row-major
   9×8 grayscale sample (0–255), compare each left pixel to its right neighbour (`>`),
   return a 64-character bit string, and require the caller's Hamming-distance threshold.
   Similarity is a candidate hint; no deletion or transitive clustering is performed.
