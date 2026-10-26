// AUTHORED-BY Codex GPT-6
const numbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  a: 1,
  an: 1,
  the: 1,
  next: 1,
  last: 1,
  past: 1,
  "after this": 1,
  few: 3,
  several: 7,
};
const amount = `(?:\\d+(?:\\.\\d+)?|half(?:\\s+an?)?|an?\\s+few|a?\\s*couple\\s*(?:of)?|after this|${Object.keys(numbers).join("|")})`;
const units = [
  ["years?|yrs?|y", 12],
  ["quarters?|qtr", 3],
  ["months?|mos?|mon", 4],
  ["weeks?|w", 7],
  ["days?|d", 24],
  ["hours?|hrs?|h", 60],
  ["minutes?|mins?|m", 60],
  ["seconds?|sec|s", 1000],
] as const;

// Shared with reminder masking so worded and compound durations stay intact.
const durationUnit = `${amount}\\s*(?:${units.map(([unit]) => unit).join("|")})\\b`;
export const durationPattern = `${durationUnit}(?:\\s*,?\\s*(?:and\\s*)?${durationUnit})*`;

/** Resolve chrono-recognised elapsed phrases without host-local Date setters. */
export function elapsedInstant(text: string, now: Date): Date {
  const negative = /^(?:last|past|-)|\b(?:ago|before|earlier)\b/i.test(text);
  const values = units.map(([unit]) => {
    const match = new RegExp(`\\b(${amount})\\s*(${unit})\\b`, "i").exec(text.toLowerCase());
    if (!match) return 0;
    const word = String(match[1]).trim();
    const value = /half/.test(word)
      ? 0.5
      : /couple/.test(word)
        ? 2
        : /few/.test(word)
          ? 3
          : (numbers[word] ?? Number(word));
    return negative ? -value : value;
  });
  const result = new Date(now);
  // Keep calendar units in UTC, carrying fractions in the same unit order as chrono.
  for (const [i, [, factor]] of units.entries()) {
    const value = Number(values[i]);
    const whole = Math.floor(value);
    const fraction = value - whole;
    if (i === 0) result.setUTCFullYear(result.getUTCFullYear() + whole);
    else if (i === 1 || i === 2)
      result.setUTCMonth(result.getUTCMonth() + whole * (i === 1 ? 3 : 1));
    else if (i === 3 || i === 4) result.setUTCDate(result.getUTCDate() + whole * (i === 3 ? 7 : 1));
    else result.setTime(result.getTime() + whole * Number([3_600_000, 60_000, 1000][i - 5]));
    if (fraction > 0) {
      // Year and quarter fractions both carry into months.
      const next = i === 0 ? 2 : i + 1;
      const carry = fraction * factor;
      values[next] = Number(values[next] ?? 0) + (i < 3 ? carry : Math.round(carry));
    }
  }
  result.setTime(result.getTime() + Number(values[8] ?? 0));
  return result;
}
