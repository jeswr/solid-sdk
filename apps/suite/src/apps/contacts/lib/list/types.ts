// AUTHORED-BY Codex GPT-6.1-Sol

/** Explicit presentation projection; adapt structured RDF contact points before calling. */
export interface ListContact {
  readonly id: string;
  readonly displayName?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly emails?: readonly string[];
  readonly phones?: readonly string[];
  readonly organization?: string;
}

export interface ListOptions {
  readonly locale?: string;
  readonly nameOrder?: "given-family" | "family-given";
}

export interface ContactSection {
  readonly label: string;
  readonly contacts: readonly ListContact[];
}

export interface ContactAvatar {
  readonly initials: string;
  /** Index in CONTACT_HUES, in design-system §2.2 order. */
  readonly colourIndex: number;
}

export type HighlightField =
  | "displayName"
  | "givenName"
  | "familyName"
  | "emails"
  | "phones"
  | "organization";

export interface HighlightRange {
  readonly field: HighlightField;
  /** Array position for emails/phones, zero for scalar fields. */
  readonly index: number;
  /** Half-open UTF-16 offsets in the unmodified input field. */
  readonly start: number;
  readonly end: number;
}

export interface ContactSearchResult {
  readonly contact: ListContact;
  /** Higher is better: the weakest matching term's tier (0 for an empty query). */
  readonly score: number;
  readonly highlights: readonly HighlightRange[];
}
