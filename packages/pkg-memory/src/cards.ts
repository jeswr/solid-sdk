// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Payment-card number detection (decisions/0004). Personal data may record a card's brand,
 * last four digits, expiry and billing address, never its full number (PAN) or security code.
 * This detector finds what looks like a PAN in free text so callers can refuse or redact it.
 */

/**
 * Design A grouping: ASCII space/hyphen, NBSP, thin/narrow no-break spaces, en/em dash.
 * Other punctuation and whitespace end a run. Percent-decode IRIs before scanning them.
 * Ideographic numerals are not covered.
 */
const SEPARATOR = /^[ \-\u00a0\u2009\u202f\u2013\u2014]$/u;
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
 * card number: a Luhn-valid window of 13-19 digits starting with 2-6, at any offset
 * in a run of Unicode digits whose groups are split by separators. Every start is
 * checked with incremental Luhn sums (linear), up to 19 digits from each match start are
 * covered so a chance-valid shorter prefix leaves no card digits behind, and overlapping
 * ranges merge.
 */
export function findCardNumbers(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let positions: number[] = [];
  let ends: number[] = [];
  let digits: number[] = [];
  const flush = () => {
    scanRun(digits, positions, ends, spans);
    positions = [];
    ends = [];
    digits = [];
  };
  let index = 0;
  for (const char of text) {
    const value = digitValue(char);
    if (value !== undefined) {
      digits.push(value);
      positions.push(index);
      ends.push(index + char.length);
    } else if (digits.length > 0 && !SEPARATOR.test(char)) flush();
    index += char.length;
  }
  flush();
  return spans;
}

function scanRun(
  digits: number[],
  positions: number[],
  ends: number[],
  spans: Array<[number, number]>,
): void {
  // Two incremental prefix sums make each Luhn window O(1). Absolute end parity
  // determines which sum doubles the penultimate digit. Uint8 residues avoid growth
  // and keep the 1 MiB adversarial case cheap even under coverage instrumentation.
  const even = new Uint8Array(digits.length + 1);
  const odd = new Uint8Array(digits.length + 1);
  let evenSum = 0;
  let oddSum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const digit = digits[i] as number;
    const doubled = digit > 4 ? digit * 2 - 9 : digit * 2;
    evenSum = (evenSum + (i % 2 === 0 ? doubled : digit)) % 10;
    oddSum = (oddSum + (i % 2 === 0 ? digit : doubled)) % 10;
    even[i + 1] = evenSum;
    odd[i + 1] = oddSum;
  }
  let coveredEnd = -2;
  for (let start = 0; start + 13 <= digits.length; start += 1) {
    if ((digits[start] as number) < 2 || (digits[start] as number) > 6) continue;
    const limit = Math.min(start + 19, digits.length);
    for (let end = start + 13; end <= limit; end += 1) {
      const sums = end % 2 === 0 ? even : odd;
      if (sums[end] !== sums[start]) continue;
      // Keep checking every later start, even inside an already covered range.
      const to = ends[limit - 1] as number;
      if (start <= coveredEnd + 1) (spans[spans.length - 1] as [number, number])[1] = to;
      else spans.push([positions[start] as number, to]);
      coveredEnd = limit - 1;
      break;
    }
  }
}

/** Whether `text` holds what looks like a payment card number. */
export function containsCardNumber(text: string): boolean {
  return findCardNumbers(text).length > 0;
}

/** Default marker shared by context readers and other redaction callers. */
export const CARD_REDACTION = "[card number removed]";

/** Replace merged card spans, preserving the original text outside those spans. */
export function redactCardNumbers(
  text: string,
  marker = CARD_REDACTION,
): { text: string; count: number } {
  const spans = findCardNumbers(text);
  const output: string[] = [];
  let cursor = 0;
  for (const [from, to] of spans) {
    output.push(text.slice(cursor, from), marker);
    cursor = to;
  }
  output.push(text.slice(cursor));
  return { text: output.join(""), count: spans.length };
}
