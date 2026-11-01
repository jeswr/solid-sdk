// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";

export { escapeIri, safeHttpIri } from "@jeswr/rdf-serialize";

/**
 * Validate and lexically escape a required scene subject base. Keep the drawing
 * API's stricter rejection of embedded C0 controls before using the shared guard.
 * Callers fail closed when the subject is undefined.
 */
export function safeSubjectBaseIri(value: string | undefined): string | undefined {
  if (typeof value === "string") {
    for (const ch of value) {
      if ((ch.codePointAt(0) ?? 0) < 0x20) return undefined;
    }
  }
  return safeHttpIri(value);
}
