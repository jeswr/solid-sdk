// AUTHORED-BY Codex GPT-6.1-Sol
import { ISO_COUNTRY_CODES, POSTAL_CODE_PATTERNS } from "./countries";
import {
  MAX_ADDRESS_COMPONENT_LENGTH,
  MAX_STREET_LINES,
  type PostalAddress,
  PostalAddressError,
  type PostalCodeWarning,
} from "./types";

const countries = new Set(ISO_COUNTRY_CODES);

export function assertCountryCode(code: string): void {
  if (typeof code !== "string") throw new PostalAddressError("INVALID_COUNTRY");
  if (code.length > MAX_ADDRESS_COMPONENT_LENGTH) throw new PostalAddressError("ADDRESS_TOO_LARGE");
  if (!countries.has(code)) throw new PostalAddressError("INVALID_COUNTRY");
}

function checkSize(value: unknown, optional = false): void {
  if (optional && value === undefined) return;
  if (typeof value !== "string") throw new PostalAddressError("INVALID_ADDRESS");
  if (value.length > MAX_ADDRESS_COMPONENT_LENGTH)
    throw new PostalAddressError("ADDRESS_TOO_LARGE");
}

export function assertPostalAddress(address: PostalAddress): void {
  if (typeof address !== "object" || address === null || Array.isArray(address)) {
    throw new PostalAddressError("INVALID_ADDRESS");
  }
  if (!Array.isArray(address.street)) throw new PostalAddressError("INVALID_ADDRESS");
  // Check array length before iteration, and ALL string lengths before any scans/copies.
  if (address.street.length > MAX_STREET_LINES) throw new PostalAddressError("ADDRESS_TOO_LARGE");
  for (const line of address.street) checkSize(line);
  for (const part of [address.locality, address.region, address.postalCode]) checkSize(part);
  for (const part of [address.poBox, address.extended, address.countryName]) checkSize(part, true);
  if (address.countryCode !== undefined) assertCountryCode(address.countryCode);
  if (address.countryCode !== undefined && address.countryName !== undefined) {
    throw new PostalAddressError("INVALID_COUNTRY");
  }
  if (address.countryName !== undefined && /^[A-Za-z]{2}$/.test(address.countryName)) {
    // Code-shaped values belong in countryCode; do not bypass country validation with a name.
    throw new PostalAddressError("INVALID_COUNTRY");
  }
  for (const part of [
    ...address.street,
    address.locality,
    address.region,
    address.postalCode,
    address.poBox,
    address.extended,
    address.countryName,
  ]) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly reject controls and embedded line breaks.
    if (part !== undefined && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(part)) {
      throw new PostalAddressError("INVALID_ADDRESS");
    }
  }
}

/** Structural/country errors throw; a nonempty invalid postal code is only a warning. */
export function validatePostalAddress(address: PostalAddress): readonly PostalCodeWarning[] {
  assertPostalAddress(address);
  const country = address.countryCode;
  const pattern = country === undefined ? undefined : POSTAL_CODE_PATTERNS[country];
  if (pattern !== undefined && address.postalCode !== "" && !pattern.test(address.postalCode)) {
    return [{ code: "INVALID_POSTAL_CODE", field: "postalCode", countryCode: country as string }];
  }
  return [];
}
