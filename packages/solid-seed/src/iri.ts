// AUTHORED-BY GPT-5.6 Sol via codex

import { safeHttpIri } from "@jeswr/rdf-serialize";

export interface HttpIriOptions {
  allowFragment?: boolean;
  requireOrigin?: boolean;
}

/** Validate without canonicalizing: RDF identity remains the caller's exact lexical IRI. */
export function assertHttpIri(value: string, label: string, options: HttpIriOptions = {}): URL {
  if (safeHttpIri(value) !== value) {
    throw new Error(`${label} must be an injection-safe absolute HTTP(S) IRI: ${value}`);
  }
  const parsed = new URL(value);
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    (options.allowFragment !== true && parsed.hash !== "")
  ) {
    throw new Error(
      `${label} must not contain credentials, query, or an unsupported fragment: ${value}`,
    );
  }
  if (options.requireOrigin === true && parsed.pathname !== "/") {
    throw new Error(`${label} must be a pod origin without a path: ${value}`);
  }
  return parsed;
}
