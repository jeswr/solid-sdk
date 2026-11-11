// AUTHORED-BY Codex GPT-6
export type PredecessorOriginsValidation =
  | { valid: true; origins: string[] }
  | { valid: false; reason: "list" | "origin" };

/** Validates the complete migration plan without normalising origins or removing duplicates. */
export function validatePredecessorOrigins(value: unknown): PredecessorOriginsValidation {
  if (!Array.isArray(value) || value.length > 32) return { valid: false, reason: "list" };
  const origins: string[] = [];
  for (const entry of value) {
    const url = typeof entry === "string" ? URL.parse(entry) : null;
    if (
      url?.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.origin !== entry ||
      url.port === "0" ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost")
    )
      return { valid: false, reason: "origin" };
    origins.push(entry);
  }
  return { valid: true, origins };
}
