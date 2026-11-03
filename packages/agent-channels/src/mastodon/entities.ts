// AUTHORED-BY Codex GPT-6.1-Sol
import { NAMED_REFERENCES } from "./named-references.js";

// HTML's historical Windows-1252 replacements for numeric character references.
// https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
const NUMERIC_REPLACEMENTS: Readonly<Record<number, number>> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

/** Decode once after stripping markup, using HTML text-context reference rules. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#(?:[xX][0-9a-fA-F]+|[0-9]+);?|[a-zA-Z][a-zA-Z0-9]*;?)/g,
    (whole: string, reference: string) => {
      if (reference[0] !== "#") {
        // Longest standard name wins; legacy names may omit their semicolon.
        // The longest WHATWG name is 32 characters, so lookup work is bounded.
        for (let length = Math.min(reference.length, 32); length > 0; length--) {
          const name = reference.slice(0, length);
          if (Object.hasOwn(NAMED_REFERENCES, name))
            return NAMED_REFERENCES[name] + reference.slice(length);
        }
        return whole;
      }
      const hex = reference[1]?.toLowerCase() === "x";
      const point = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(NUMERIC_REPLACEMENTS[point] ?? point);
    },
  );
}
