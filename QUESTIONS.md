<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SHT-L6 conservative interpretations

These questions concern `specs/apps/14-pure-libraries-6.md` and the SHT-L6 task's rule
semantics; none blocks the pure library. The following choices are implemented and tested.

1. Does blank include empty strings, whitespace, or only null? Treat `null` and `""`
   as blank; preserve whitespace. Comparisons accept only numbers and strings. Duplicate
   and unique rules count nonblank numbers, strings, and booleans separately; errors and
   blanks do not participate. Alternatives are null-only blanks or counting blank/error
   values as duplicates.
2. Which colour syntax and style properties should the engine expose? Accept opaque
   `#RGB` / `#RRGGBB` colours, normalize them to uppercase six-digit hex, and expose a
   closed, flat style (`fill`, `fontColor`, `bold`, `italic`, `underline`,
   `strikethrough`, `numberFormat`). Reject other syntax/properties rather than guessing
   at CSS or engine-specific styles. Broader CSS colour parsing and nested engine styles
   are alternatives outside this task's specified surface.
3. How are ranks and scale anchors rounded or degenerate ranges coloured? Absolute N is
   a positive safe integer; percentages are finite in (0, 100], use `ceil(count*N/100)`,
   and include ties. Percent anchors interpolate between numeric min/max; percentiles
   linearly interpolate at `(count-1)*p/100`. Anchors must resolve in nondecreasing order;
   values outside them clamp to endpoint colours. Equal anchors choose the first colour
   at the shared value (including a constant range). Alternatives include nearest-rank
   percentiles and a midpoint colour for constant ranges.
4. Which error codes cover malformed ranges and too many rules? Use `INVALID_RANGE` for
   ragged/sparse ranges, unsupported cells and nonfinite numbers; use `INVALID_RULE` for
   malformed/unsupported rules and more than `MAX_RULES`. Oversized ranges use
   `RANGE_TOO_LARGE`. An alternative is a separate rule-count error, not named by the task.
