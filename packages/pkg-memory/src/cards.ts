// AUTHORED-BY Claude Opus 5.5
/**
 * Payment-card number detection (decisions/0004). Personal data may record a card's brand,
 * last four digits, expiry and billing address, never its full number (PAN) or security code.
 * This detector finds what looks like a PAN in free text so callers can refuse or redact it.
 */

/**
 * Leading digits a card number may start with. Every issuer range except 0 (unassigned) is
 * covered, including UATP (1), Maestro (50, 56-69), RuPay (60, 65, 81, 82) and
 * petroleum cards (7).
 */
const CARD_PREFIX = /^[1-9]/;

/**
 * Characters that may sit between digit groups without ending a run: whitespace, any
 * punctuation (dashes, dots, quotes, brackets, slashes, middle dots), invisible format
 * characters (zero-width space, soft hyphen), any combining mark, and `+ = ~ |`. Callers
 * should percent-decode IRIs before scanning them. Ideographic numerals are not covered.
 */
const SEPARATOR = /^[\s\p{Z}\p{P}\p{Cf}\p{M}+=~|]$/u;
const DECIMAL = /^\p{Nd}$/u;
const NUMBER = /^\p{N}$/u;
const PUNCTUATION = /\p{P}/gu;

/**
 * Value of a digit character: any Unicode decimal digit, or a number character whose NFKC
 * form is one decimal digit, possibly with punctuation (circled, superscript, subscript,
 * parenthesised or full-stop digits). Undefined otherwise. Only number characters are cached.
 */
const digitValues = new Map<number, number | undefined>();
function digitValue(char: string): number | undefined {
  const code = char.codePointAt(0) as number;
  if (code >= 48 && code <= 57) return code - 48;
  if (!NUMBER.test(char)) return undefined;
  if (digitValues.has(code)) return digitValues.get(code);
  let value: number | undefined;
  if (DECIMAL.test(char)) {
    let zero = code;
    // Walk back to the start of this run of decimal digits; runs are whole blocks of ten.
    while (zero > 0 && code - zero < 60 && DECIMAL.test(String.fromCodePoint(zero - 1))) zero -= 1;
    value = (code - zero) % 10;
  } else {
    const folded = char.normalize("NFKC").replace(PUNCTUATION, "");
    if (folded !== char && [...folded].length === 1) value = digitValue(folded);
  }
  digitValues.set(code, value);
  return value;
}

/**
 * Spans of `text` (UTF-16 start inclusive, end exclusive) holding what looks like a payment
 * card number: a Luhn-valid window of 12-19 digits not starting with 0, at any offset
 * in a run of Unicode digits whose groups are split by separators. Every start is
 * checked with incremental Luhn sums (linear), up to 19 digits from each match start are
 * covered so a chance-valid shorter prefix leaves no card digits behind, and overlapping
 * ranges merge.
 */
export function findCardNumbers(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let positions: number[] = [];
  let ends: number[] = [];
  let digits = "";
  const flush = () => {
    scanRun(digits, positions, ends, spans);
    positions = [];
    ends = [];
    digits = "";
  };
  let index = 0;
  for (const char of text) {
    const value = digitValue(char);
    if (value !== undefined) {
      digits += String(value);
      positions.push(index);
      ends.push(index + char.length);
    } else if (digits.length > 0 && !SEPARATOR.test(char)) flush();
    index += char.length;
  }
  flush();
  return spans;
}

function scanRun(
  digits: string,
  positions: number[],
  ends: number[],
  spans: Array<[number, number]>,
): void {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start + 12 <= digits.length; start += 1) {
    if (!CARD_PREFIX.test(digits[start] as string)) continue;
    // evenSum doubles digits at even offsets from start; oddSum doubles odd offsets.
    let evenSum = 0;
    let oddSum = 0;
    for (let i = start; i < start + 19 && i < digits.length; i += 1) {
      const digit = Number(digits[i]);
      const doubled = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
      if ((i - start) % 2 === 0) {
        evenSum += doubled;
        oddSum += digit;
      } else {
        evenSum += digit;
        oddSum += doubled;
      }
      const length = i - start + 1;
      // Luhn doubles every second digit counting from the right-most (check) digit.
      if (length >= 12 && (length % 2 === 0 ? evenSum : oddSum) % 10 === 0) {
        const end = Math.min(start + 19, digits.length) - 1;
        const last = ranges[ranges.length - 1];
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else ranges.push([start, end]);
        break;
      }
    }
  }
  for (const [from, to] of ranges) spans.push([positions[from] as number, ends[to] as number]);
}

/** Whether `text` holds what looks like a payment card number. */
export function containsCardNumber(text: string): boolean {
  return findCardNumbers(text).length > 0;
}
