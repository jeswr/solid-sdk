// AUTHORED-BY Codex GPT-6.1-Sol
export const MAX_STREET_LINES = 8;
/** Measured before normalization, in JavaScript UTF-16 code units, per scalar/street line. */
export const MAX_ADDRESS_COMPONENT_LENGTH = 256;
/** Fourteen text values, each maximally escaped, plus six semicolons and seven commas. */
export const MAX_ADR_VALUE_LENGTH =
  (MAX_STREET_LINES + 6) * MAX_ADDRESS_COMPONENT_LENGTH * 2 + 6 + MAX_STREET_LINES - 1;

/** Empty strings are allowed. Omit countryCode when importing a country name or no country. */
export interface PostalAddress {
  readonly street: readonly string[];
  readonly locality: string;
  readonly region: string;
  readonly postalCode: string;
  /** Assigned ISO 3166-1 alpha-2 only; uppercase, never inferred from countryName. */
  readonly countryCode?: string;
  /** Original ADR country text. Mutually exclusive with countryCode. */
  readonly countryName?: string;
  readonly poBox?: string;
  readonly extended?: string;
}

export type PostalAddressErrorCode =
  | "ADDRESS_TOO_LARGE"
  | "INVALID_COUNTRY"
  | "INVALID_ADDRESS"
  | "INVALID_ADR";

/** Messages deliberately contain no address data. */
export class PostalAddressError extends Error {
  constructor(public readonly code: PostalAddressErrorCode) {
    super(`Postal address: ${code}`);
    this.name = "PostalAddressError";
  }
}

export interface PostalCodeWarning {
  readonly code: "INVALID_POSTAL_CODE";
  readonly field: "postalCode";
  readonly countryCode: string;
}
