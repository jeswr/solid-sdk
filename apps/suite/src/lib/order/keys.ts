// AUTHORED-BY Codex GPT-6.1-Sol

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function validateKey(key: string | null): void {
  if (key !== null && (key.length === 0 || /[^0-9A-Za-z]/.test(key) || key.endsWith("0"))) {
    throw new RangeError("Order keys must be nonempty base-62 strings without a trailing 0");
  }
}

function validateBounds(lower: string | null, upper: string | null): void {
  validateKey(lower);
  validateKey(upper);
  if (lower !== null && upper !== null && lower >= upper) {
    throw new RangeError("The lower order key must precede the upper key");
  }
}

/** Bounds are validated by public entry points; missing lower digits represent zero. */
function midpoint(lower: string | null, upper: string | null): string {
  let prefix = "";
  let index = 0;
  for (;;) {
    const low = DIGITS.indexOf(lower?.charAt(index) || "0");
    const high = upper === null ? DIGITS.length : DIGITS.indexOf(upper.charAt(index));
    if (high - low > 1) {
      return prefix + DIGITS.charAt(Math.floor((low + high) / 2));
    }
    prefix += DIGITS.charAt(low);
    // Once we choose a digit below the upper bound, its remaining suffix is irrelevant.
    if (low < high) upper = null;
    index += 1;
  }
}

/**
 * Return a deterministic base-62 key strictly between the bounds (null means unbounded).
 * Keys are fractional digits, nonempty with no trailing 0. Use ordinary string comparison
 * (`<`, `>`, or default sort), never localeCompare. Equal or reversed bounds and malformed
 * keys throw RangeError. Concurrent calls with the same bounds produce the same key;
 * resolving concurrent collisions belongs to the caller.
 */
export function generateKeyBetween(lower: string | null, upper: string | null): string {
  validateBounds(lower, upper);
  return midpoint(lower, upper);
}

/**
 * Return count strictly increasing keys inside the bounds without changing existing keys.
 * Balanced subdivision limits key growth compared with repeatedly inserting at one end.
 * Count must be a nonnegative safe integer; even zero validates the supplied bounds.
 */
export function generateNKeysBetween(
  lower: string | null,
  upper: string | null,
  count: number,
): string[] {
  validateBounds(lower, upper);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Order key count must be a nonnegative safe integer");
  }
  const keys: string[] = [];
  function fill(left: string | null, right: string | null, size: number): void {
    if (size === 0) return;
    const middle = midpoint(left, right);
    const leftSize = Math.floor(size / 2);
    fill(left, middle, leftSize);
    keys.push(middle);
    fill(middle, right, size - leftSize - 1);
  }
  fill(lower, upper, count);
  return keys;
}

/**
 * Replace strictly increasing keys with a compact balanced sequence, preserving positions.
 * Returns a fresh array and never mutates input. Empty input returns []. Callers must apply
 * all replacements together and coordinate with concurrent writers before persisting.
 */
export function rebalanceKeys(keys: readonly string[]): string[] {
  let previous: string | null = null;
  for (const key of keys) {
    validateBounds(previous, key);
    previous = key;
  }
  return generateNKeysBetween(null, null, keys.length);
}
