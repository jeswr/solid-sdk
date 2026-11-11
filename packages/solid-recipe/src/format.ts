// AUTHORED-BY Codex (GPT-6.1 Sol)
const fractions: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅐": 1 / 7,
  "⅑": 1 / 9,
  "⅒": 0.1,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
const quantity =
  "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\s*[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?)";
const leading = new RegExp(
  `^(\\s*)(${quantity})(?:\\s*(–|—|-|to)\\s*(${quantity}))?(?=\\s|$)(.*)$`,
  "i",
);
function amount(text: string): number {
  const value = text.trim();
  const last = value.at(-1) as string;
  if (fractions[last] !== undefined)
    return Number(value.slice(0, -1).trim() || 0) + (fractions[last] as number);
  const mixed = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(value);
  if (mixed) return Number(mixed[1] ?? 0) + Number(mixed[2]) / Number(mixed[3]);
  return Number(value);
}
function display(value: number): string {
  const whole = Math.floor(value);
  const fraction = value - whole;
  for (const [numerator, denominator] of [
    [1, 8],
    [1, 4],
    [1, 3],
    [3, 8],
    [1, 2],
    [5, 8],
    [2, 3],
    [3, 4],
    [7, 8],
  ] as const) {
    if (Math.abs(fraction - numerator / denominator) < 0.00001)
      return `${whole ? `${whole} ` : ""}${numerator}/${denominator}`;
  }
  return String(Math.round(value * 1000) / 1000);
}
/** Scale only an initial quantity/range; package sizes and preparation text stay intact. */
export function scaleIngredient(line: string, factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new TypeError("Choose a positive servings multiplier");
  const match = leading.exec(line);
  if (!match || factor === 1) return line;
  const first = amount(match[2] as string) * factor;
  const second = match[4] ? amount(match[4]) * factor : undefined;
  if (!Number.isFinite(first) || (second !== undefined && !Number.isFinite(second))) return line;
  return `${match[1]}${display(first)}${second === undefined ? "" : `–${display(second)}`}${match[5]}`;
}

/** Cooking durations only: months/years have no fixed minute conversion. */
export function durationMinutes(value: string): number | undefined {
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!match?.slice(1).some(Boolean) || value.endsWith("T")) return undefined;
  const minutes =
    Number(match[1] ?? 0) * 1440 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0) +
    Number(match[4] ?? 0) / 60;
  return Number.isFinite(minutes) ? minutes : undefined;
}
export function formatDuration(value?: string): string {
  if (!value) return "";
  const minutes = durationMinutes(value);
  if (minutes === undefined) return value;
  if (minutes === 0) return "0 min";
  if (minutes < 1) return "Less than a minute";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return [hours ? `${hours} hr` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ");
}
