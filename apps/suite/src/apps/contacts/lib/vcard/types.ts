// AUTHORED-BY Codex GPT-6.1-Sol
export type VCardVersion = "3.0" | "4.0";

/** Multiple text values per component preserve names such as two family names. */
export interface VCardName {
  family: string[];
  given: string[];
  additional: string[];
  prefixes: string[];
  suffixes: string[];
}

export interface VCardAddress {
  poBox: string[];
  extended: string[];
  street: string[];
  locality: string[];
  region: string[];
  postalCode: string[];
  country: string[];
}

/** Parameter names are uppercase; TYPE values are lowercase. No transport encoding survives. */
export interface VCardField<T> {
  value: T;
  parameters: Record<string, string[]>;
  group?: string;
}

/** Supported semantic subset; unknown properties and binary photos are intentionally omitted. */
export interface VCard {
  version: VCardVersion;
  fn: string;
  n?: VCardName;
  emails: VCardField<string>[];
  tels: VCardField<string>[];
  addresses: VCardField<VCardAddress>[];
  org?: string[];
  title?: string;
  /** Kept verbatim: full/reduced dates, text birthdays and Apple's year-1604 sentinel. */
  bday?: string;
  /** Explicit BDAY VALUE parameter, lowercase; omitted when the source uses the default type. */
  bdayValueType?: string;
  note?: string;
  /** URI only, never fetched. */
  photo?: string;
  categories: string[];
}
