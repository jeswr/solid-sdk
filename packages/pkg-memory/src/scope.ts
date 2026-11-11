// AUTHORED-BY Codex GPT-6.1-Sol
/** Projection of a verified, unrevoked owner mandate. The host verifies its signed memoryScope. */
export interface MemoryMandate {
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly validFrom: string;
  readonly validUntil: string;
  /** Exact DPV personal-data category IRIs or pd: names; absent selects the preference default. */
  readonly memoryScope?: readonly string[];
}

const PD = "https://w3id.org/dpv/pd#";
/** Exact categories only; other categories require an explicit mandate entry. */
export const DEFAULT_MEMORY_SCOPE: readonly string[] = Object.freeze([`${PD}Preference`]);

export function memoryCategory(value: string): string {
  const expanded = value.startsWith("pd:") ? PD + value.slice(3) : value;
  if (!expanded.startsWith(PD) || !/^[A-Za-z][A-Za-z0-9]*$/.test(expanded.slice(PD.length)))
    throw new TypeError("Expected a DPV personal-data category");
  return expanded;
}

/** Exact membership after explicit CURIE expansion; no subclass or wildcard inference. */
export function scopeAdmits(
  scope: readonly string[] | undefined,
  categories: readonly string[],
): boolean {
  if (categories.length === 0) return false;
  const allowed = new Set((scope ?? DEFAULT_MEMORY_SCOPE).map(memoryCategory));
  return categories.every((category) => allowed.has(memoryCategory(category)));
}
