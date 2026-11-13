// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

/** Zone-free timestamps default to London, independent of the host zone.
 * Repeats use the earlier instant; gaps advance by the transition's duration
 * (Temporal's compatible rule). Date-only values stay xsd:date.
 */
export const BANK_TIME_ZONE = "Europe/London";
export function bankDateFormatter(timeZone = BANK_TIME_ZONE): Intl.DateTimeFormat {
  // Intl also accepts fixed offsets in newer runtimes; this option requires an IANA name.
  if (timeZone.length > 256 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone))
    throw new TypeError("timeZone must be a valid IANA time zone");
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
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
  } catch {
    throw new TypeError("timeZone must be a valid IANA time zone");
  }
}
const defaultFormatter = bankDateFormatter();
function wallTime(instant: number, formatter: Intl.DateTimeFormat): string {
  const p = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return `${p.year?.padStart(4, "0")}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function bankDate(
  raw: string,
  uk = false,
  formatter = defaultFormatter,
): string | undefined {
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
  const candidates = [-86400000, 0, 86400000].map((delta) => {
    const probe = nominal + delta;
    return nominal - (Date.parse(`${wallTime(probe, formatter)}Z`) - probe);
  });
  const exact = candidates.filter((candidate) => wallTime(candidate, formatter) === local);
  // No exact candidate means a forward transition: the pre-transition offset
  // yields the later instant, shifting the wall time forward across the gap.
  const instant = exact.length ? Math.min(...exact) : Math.max(...candidates);
  return new Date(instant + Number(`0${text.slice(19)}`) * 1000).toISOString();
}
