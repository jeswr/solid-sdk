// AUTHORED-BY Codex GPT-6.1-Sol
import { caseFolding } from "./case-folding";
import { DedupeError, text } from "./errors";

/** Bare ASCII dot-atom address only. Plus-tags and dots remain significant. */
export function normaliseEmail(value: string): string {
  text(value, "invalid-email");
  const email = value.trim();
  if (
    email.length > 254 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
      email,
    )
  ) {
    throw new DedupeError("invalid-email");
  }
  const [local, domain] = email.split("@") as [string, string];
  if (local.length > 64 || domain.split(".").some((label) => label.length > 63)) {
    throw new DedupeError("invalid-email");
  }
  return email.toLowerCase();
}

export function validateCountryCode(code: string | undefined): void {
  if (code !== undefined && (typeof code !== "string" || !/^[1-9][0-9]{0,2}$/.test(code))) {
    throw new DedupeError("invalid-country-code");
  }
}

/** No extension, region inference, optional trunk marker, or IDD conversion. */
export function normalisePhone(value: string, defaultCountryCallingCode?: string): string {
  validateCountryCode(defaultCountryCallingCode);
  text(value, "invalid-phone");
  const phone = value.trim();
  // Parentheses must enclose a nonempty group of digits, without nesting.
  if (!/^\+?[0-9 .()-]+$/.test(phone) || /\(0\)/.test(phone)) {
    throw new DedupeError("invalid-phone");
  }
  const ungrouped = phone.replace(/\([0-9]+\)/g, "");
  if (/[()]/.test(ungrouped)) throw new DedupeError("invalid-phone");
  let result = phone.replace(/[ .()-]/g, "");
  if (!/^\+?[0-9]{1,15}$/.test(result) || result.startsWith("+0")) {
    throw new DedupeError("invalid-phone");
  }
  if (!result.startsWith("+") && defaultCountryCallingCode !== undefined) {
    if (result.startsWith("0")) throw new DedupeError("invalid-phone");
    result = `+${defaultCountryCallingCode}${result}`;
  }
  if (result.replace("+", "").length > 15) throw new DedupeError("invalid-phone");
  return result;
}

/** Unicode 17 default full folding, after NFKC; accents and internal spacing stay. */
export function normaliseName(value: string): string {
  text(value, "invalid-name");
  if (/\p{Cc}/u.test(value)) throw new DedupeError("invalid-name");
  return Array.from(value.normalize("NFKC").trim(), (point) => caseFolding[point] ?? point).join(
    "",
  );
}

/** Validate without WHATWG URL canonicalisation: RDF identifier spelling stays exact. */
export function validateWebId(value: string): string {
  text(value, "invalid-webid");
  if (!/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(value) || /[\s\\<>"{}|^`\p{Cc}]/u.test(value)) {
    throw new DedupeError("invalid-webid");
  }
  if (/%(?![0-9a-f]{2})/i.test(value)) throw new DedupeError("invalid-webid");
  try {
    new URL(value);
  } catch {
    throw new DedupeError("invalid-webid");
  }
  return value;
}
