// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Ported from the pilot runtime/transmission.ts; unclassified errors never imply absence. */
export const MAX_TRANSMISSION_ATTEMPTS = 3;
// Existing synthetic/direct refs; Gmail and Graph object IDs; Matrix event IDs;
// and Graph sendMail's deterministic Internet Message-ID. Matrix's opaque suffix
// is limited to printable ASCII here. Every alternative excludes whitespace and
// controls, and the largest (Graph lookup) is bounded at 2048 characters.
const PROVIDER_REF =
  /^(?:[A-Za-z0-9._:-]{1,256}|[A-Za-z0-9_+/=-]{1,2048}|\$[\x21-\x7e]{1,254}|<awp-[a-f0-9]{40}@awp-pilot\.invalid>)(?![\s\S])/;
export function providerResult(
  value: unknown,
  lookup: boolean,
): "accepted" | "rejected" | "found" | "absent" | "unknown" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const result = value as Record<string, unknown>;
  const outcome = result.outcome;
  const keys = Object.keys(result).sort().join(",");
  if (
    (lookup ? outcome === "found" : outcome === "accepted") &&
    keys === "outcome,providerRef" &&
    typeof result.providerRef === "string" &&
    PROVIDER_REF.test(result.providerRef)
  )
    return lookup ? "found" : "accepted";
  if (
    !lookup &&
    outcome === "rejected" &&
    keys === "detail,outcome" &&
    typeof result.detail === "string"
  )
    return "rejected";
  if (lookup && outcome === "absent" && keys === "outcome") return "absent";
  return "unknown";
}
export async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("provider timeout")), ms);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
