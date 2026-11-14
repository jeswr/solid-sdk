// AUTHORED-BY Codex GPT-6.1-Sol
import type { EndpointCandidate } from "@jeswr/site-profiler";

export const credentialRejection = "Unresolved session material in learning candidate.";

/** Scan every string, including object keys and strings containing encoded JSON/URLs/forms.
 * The shared executor redactor owns normalization, credential forms and short-token boundaries.
 */
export function containsCredential(value: unknown, redact: (text: string) => string): boolean {
  if (typeof value === "string")
    return /\[redacted\]|%5bredacted%5d/i.test(value) || redact(value) !== value;
  if (Array.isArray(value)) return value.some((item) => containsCredential(item, redact));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, item]) => containsCredential(key, redact) || containsCredential(item, redact),
    );
  return false;
}

/** Scan the prospective template before sanitization can discard credential evidence.
 * Samples/forms are source evidence, not executable constants. Verified CSRF values have
 * already become slots; retain their names in the scan. Fragments are otherwise lost when
 * the profiler builds URL templates, so include them explicitly.
 */
export function candidateContainsCredential(
  candidate: EndpointCandidate,
  redact: (text: string) => string,
): boolean {
  const { samples, form: _form, script: _script, ...template } = candidate;
  return containsCredential(
    {
      ...template,
      params: candidate.params.map((param) =>
        candidate.csrf.some((rule) => rule.target.name === param.name)
          ? { ...param, examples: [] }
          : param,
      ),
      // The profiler keeps only model-eligible headers. A credential in another header
      // still rejects the candidate; verified header slots retain only their names.
      witnessedHeaders: samples.map((sample) =>
        Object.fromEntries(
          Object.entries(sample.requestHeaders).map(([name, value]) => [
            name,
            candidate.csrf.some(
              (rule) =>
                rule.target.kind === "header" &&
                rule.target.name.toLowerCase() === name.toLowerCase(),
            )
              ? undefined
              : value,
          ]),
        ),
      ),
      fragments: samples.map((sample) => new URL(sample.url).hash),
    },
    redact,
  );
}
