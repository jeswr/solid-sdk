// AUTHORED-BY Claude Opus 5.5
/**
 * Payment-card number detection (decisions/0004). Personal data may record a card's brand,
 * last four digits, expiry and billing address, never its full number (PAN) or security code.
 * This detector finds what looks like a PAN in free text so callers can refuse or redact it.
 */

/** Issuer prefixes of the major card networks (Visa, Mastercard, Amex, Diners, JCB, Discover, UnionPay). */
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[0-9]|6)/;

/** Separators allowed between digit groups: any whitespace or dash, `.`, `,`, `_` or `/`. */
const SEPARATOR = /^[\s\p{Zs}\p{Pd}.,_/]$/u;
const DIGIT = /^\p{Nd}$/u;

/** ASCII value of a Unicode decimal digit; Nd digits come in aligned runs of ten. */
const digitValues = new Map<number, number>();
function digitValue(char: string): number {
  const code = char.codePointAt(0) as number;
  if (code >= 48 && code <= 57) return code - 48;
  const cached = digitValues.get(code);
  if (cached !== undefined) return cached;
  let zero = code;
  // Walk back to the start of this run of decimal digits; runs are whole blocks of ten.
  while (zero > 0 && code - zero < 60 && DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
  const value = (code - zero) % 10;
  digitValues.set(code, value);
  return value;
}

/**
 * Spans of `text` (UTF-16 start inclusive, end exclusive) holding what looks like a payment
 * card number: a Luhn-valid window of 12-19 digits with a card-network prefix, at any offset
 * in a run of Unicode decimal digits whose groups are split by separators. Every start is
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
    if (DIGIT.test(char)) {
      digits += String(digitValue(char));
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
    if (!CARD_PREFIX.test(digits.slice(start, start + 4))) continue;
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
