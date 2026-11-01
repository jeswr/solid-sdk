// AUTHORED-BY Codex GPT-6.1-Sol
import { AddressError, requireAddress, text } from "./errors";

function asciiHost(value: string): string {
  try {
    // The suffix prevents WHATWG's IPv4 shorthand interpretation of numeric labels.
    // This constructs a URL only; no network access occurs.
    return new URL(`http://${value}.invalid`).hostname.slice(0, -8);
  } catch {
    throw new AddressError("invalid-domain");
  }
}

/** DNS/IDN domains only. No URL, IP-literal, trailing dot, or alternate dot separator. */
export function domainToASCII(value: string): string {
  text(value);
  requireAddress(/^[\p{L}\p{M}\p{N}.-]+$/u.test(value), "invalid-domain");
  const ascii = asciiHost(value.normalize("NFC"));
  requireAddress(
    ascii.length <= 253 &&
      ascii.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
    "invalid-domain",
  );
  requireAddress(
    ascii.split(".").every((label) => {
      if (!label.startsWith("xn--")) return true;
      const unicode = decodeLabel(label);
      // Some URL implementations fast-path ASCII A-labels. Check their Unicode form too,
      // including IDNA bidi/context rules and canonical re-encoding.
      return /^[\p{L}\p{M}\p{N}-]+$/u.test(unicode) && asciiHost(unicode) === label;
    }),
    "invalid-domain",
  );
  return ascii;
}

/** RFC 3492 §6.1; only called with the bounded, URL-validated A-label payload. */
function adapt(delta: number, points: number, first: boolean): number {
  let value = first ? Math.floor(delta / 700) : Math.floor(delta / 2);
  value += Math.floor(value / points);
  let bias = 0;
  while (value > 455) {
    value = Math.floor(value / 35);
    bias += 36;
  }
  return bias + Math.floor((36 * value) / (value + 38));
}

/** RFC 3492 §6.2 with explicit truncation, overflow and Unicode scalar checks. */
function decodeLabel(label: string): string {
  const payload = label.slice(4);
  const separator = payload.lastIndexOf("-");
  const output = Array.from(payload.slice(0, Math.max(0, separator)), (char) => char.charCodeAt(0));
  let cursor = separator + 1;
  let n = 128;
  let i = 0;
  let bias = 72;
  while (cursor < payload.length) {
    const previous = i;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      requireAddress(cursor < payload.length, "invalid-domain");
      const code = payload.charCodeAt(cursor++);
      const digit = code >= 97 ? code - 97 : code - 22;
      i += digit * weight;
      requireAddress(Number.isSafeInteger(i) && i <= 0x7fffffff, "invalid-domain");
      const threshold = Math.max(1, Math.min(26, k - bias));
      if (digit < threshold) break;
      weight *= 36 - threshold;
    }
    const size = output.length + 1;
    bias = adapt(i - previous, size, previous === 0);
    n += Math.floor(i / size);
    requireAddress(n <= 0x10ffff && (n < 0xd800 || n > 0xdfff), "invalid-domain");
    i %= size;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

export function domainToUnicode(value: string): string {
  return domainToASCII(value)
    .split(".")
    .map((label) => (label.startsWith("xn--") ? decodeLabel(label) : label))
    .join(".");
}
