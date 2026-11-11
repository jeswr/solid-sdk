// AUTHORED-BY GPT-6.1 Sol
export interface LegacyKeys {
  indexedDb?: string[];
  localStorage?: string[];
  sessionStorage?: string[];
}

/** Remove obsolete credentials once. Each operation survives unavailable browser storage. */
export function clearLegacyCredentials(keys: LegacyKeys): void {
  for (const key of keys.indexedDb ?? []) {
    try {
      globalThis.indexedDB?.deleteDatabase(key);
    } catch {
      // Private mode or a storage policy may deny access.
    }
  }
  for (const storage of ["localStorage", "sessionStorage"] as const) {
    for (const key of keys[storage] ?? []) {
      try {
        globalThis[storage]?.removeItem(key);
      } catch {
        // Continue with the remaining keys even if this removal failed.
      }
    }
  }
}
