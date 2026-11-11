// AUTHORED-BY Codex GPT-6.1-Sol
/** Amounts never pass through Number. Limit digits before any BigInt arithmetic. */
export function normaliseAmount(raw: string): string | undefined {
  if (raw.length > 128) return undefined;
  let text = raw.trim();
  const parentheses = /^\((.*)\)$/.exec(text);
  if (parentheses) text = `-${parentheses[1]}`;
  text = text.replace(/^([+-]?)[£$€]/, "$1");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return undefined;
  const unsigned = text.replace(/^[+-]/, "").replaceAll(",", "");
  if (unsigned.replace(".", "").length > 64) return undefined;
  const canonical = unsigned.replace(/^0+(?=\d)/, "");
  return `${text.startsWith("-") && /[1-9]/.test(canonical) ? "-" : ""}${canonical}`;
}

/** Exact signed subtraction, preserving the greatest input scale. */
export function subtractAmount(amount: string, fee: string): string {
  const scale = Math.max(amount.split(".")[1]?.length ?? 0, fee.split(".")[1]?.length ?? 0);
  const integer = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  };
  const result = integer(amount) - integer(fee);
  const digits = (result < 0n ? -result : result).toString().padStart(scale + 1, "0");
  return `${result < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}

/** Identity ignores insignificant decimal zeros, while display retains source scale. */
export function amountKey(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

// ICU supplies the runtime's ISO 4217 codes; arbitrary three-letter text is not money.
const currencies = new Set(Intl.supportedValuesOf("currency"));
export function currencyCode(value: string): string | undefined {
  return /^[A-Z]{3}$/.test(value) && currencies.has(value) ? value : undefined;
}

/** UK exports without a zone use Europe/London, independent of the host zone.
 * Date-only values stay xsd:date; repeated autumn wall times use the first
 * occurrence, and nonexistent spring wall times are refused.
 */
export const BANK_TIME_ZONE = "Europe/London";
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANK_TIME_ZONE,
  calendar: "iso8601",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function wallTime(instant: number): string {
  const p = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return `${p.year?.padStart(4, "0")}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function bankDate(raw: string, uk = false): string | undefined {
  let text = raw.trim();
  if (uk) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!match) return undefined;
    text = `${match[3]}-${match[2]}-${match[1]}`;
  }
  text = text.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text))
    return undefined;
  const day = text.slice(0, 10);
  const midnight = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(midnight.getTime()) ||
    midnight.toISOString().slice(0, 10) !== day ||
    day.startsWith("0000")
  )
    return undefined;
  if (text.length === 10) return text;
  if (
    Number(text.slice(11, 13)) > 23 ||
    Number(text.slice(14, 16)) > 59 ||
    Number(text.slice(17, 19)) > 59
  )
    return undefined;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    if (
      /[+-]\d{2}:\d{2}$/.test(text) &&
      (Number(text.slice(-5, -3)) > 14 ||
        Number(text.slice(-2)) > 59 ||
        (Number(text.slice(-5, -3)) === 14 && Number(text.slice(-2)) !== 0))
    )
      return undefined;
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
  }
  const local = text.slice(0, 19);
  const nominal = Date.parse(`${local}Z`);
  const candidates = [-86400000, 0, 86400000]
    .map((delta) => {
      const probe = nominal + delta;
      return nominal - (Date.parse(`${wallTime(probe)}Z`) - probe);
    })
    .filter((candidate) => wallTime(candidate) === local);
  if (!candidates.length) return undefined;
  return new Date(Math.min(...candidates) + Number(`0${text.slice(19)}`) * 1000).toISOString();
}
