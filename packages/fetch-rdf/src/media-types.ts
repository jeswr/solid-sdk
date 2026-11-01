// AUTHORED-BY Codex GPT-6.1-Sol
/** Media types this dispatch helper recognises. Anything else triggers
 * an {@link RdfFetchError} rather than a silent best-effort parse. */
export const SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json",
] as const;
