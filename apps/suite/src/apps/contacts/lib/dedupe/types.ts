// AUTHORED-BY Codex GPT-6.1-Sol

/** Explicit merge-safe projection; adapters retain RDF/contact-point metadata separately. */
export interface DedupeContact {
  readonly id: string;
  /** Single-valued fields, e.g. name, organization, note. Absent fields are omitted. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Other string sets, e.g. labels or address references. Exact value equality. */
  readonly multiFields?: Readonly<Record<string, readonly string[]>>;
  readonly webIds?: readonly string[];
  /** Bare addresses, without mailto:. */
  readonly emails?: readonly string[];
  /** Display numbers, without tel: or extensions. */
  readonly phones?: readonly string[];
}

export interface DedupeOptions {
  readonly defaultCountryCallingCode?: string;
}

export interface ContactCluster {
  /** Lowest contact ID, using locale-independent UTF-16 order. */
  readonly id: string;
  readonly contactIds: readonly string[];
}

export interface FieldValue {
  readonly value: string;
  readonly sourceIds: readonly string[];
}

export interface FieldConflict {
  readonly field: string;
  readonly winner: FieldValue;
  /** Every distinct losing value, with the IDs that supplied it. */
  readonly alternatives: readonly FieldValue[];
}

export interface MergePlan extends ContactCluster {
  readonly targetId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly multiFields: Readonly<Record<string, readonly FieldValue[]>>;
  /** Identity sets contain normalised values, with provenance. */
  readonly webIds: readonly FieldValue[];
  readonly emails: readonly FieldValue[];
  readonly phones: readonly FieldValue[];
  readonly conflicts: readonly FieldConflict[];
}
