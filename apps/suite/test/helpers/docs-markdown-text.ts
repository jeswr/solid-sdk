// AUTHORED-BY Codex
import fc from "fast-check";

// Exercise all Unicode space separators, line controls, invisible format
// characters, and whitespace-only runs as well as ordinary Markdown syntax.
export const markdownWhitespace = fc.constantFrom(
  " ",
  "   ",
  "\t",
  "\n",
  "\r",
  "\r\n",
  "\v",
  "\f",
  "\u0085",
  "\u00a0",
  "\u1680",
  ...Array.from({ length: 11 }, (_, index) => String.fromCodePoint(0x2000 + index)),
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\u200b",
  "\u200c",
  "\u200d",
  "\u2060",
  "\ufeff",
);

export const markdownText = fc
  .tuple(
    fc.oneof(fc.constant(""), markdownWhitespace),
    fc.array(
      fc.oneof(fc.constantFrom(..."abc XYZ0123#>-+*._`[]<>()\\!~=|&:\"'@😀"), markdownWhitespace),
      {
        minLength: 1,
        maxLength: 20,
      },
    ),
    fc.oneof(fc.constant(""), markdownWhitespace),
  )
  .map(([leading, middle, trailing]) => `${leading}${middle.join("")}${trailing}`);
