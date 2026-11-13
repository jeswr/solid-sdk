// AUTHORED-BY Claude Opus 5.5
/** Vocabulary IRIs of the site-action ontology (site-action.ttl) and the terms it reuses. */
import type { EffectClass } from "./types.js";
import { SAB, SCHEMA } from "./types.js";

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const PROV = "http://www.w3.org/ns/prov#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";

/** Legacy http scheme for schema.org, normalised to {@link SCHEMA} on read. */
export const SCHEMA_HTTP = "http://schema.org/";

export const RDF_TYPE = `${RDF}type`;
export const RDF_FIRST = `${RDF}first`;
export const RDF_REST = `${RDF}rest`;
export const RDF_NIL = `${RDF}nil`;

/** sab: terms the facade reads or writes outside the generated model. */
export const SAB_VALUE_PATH = `${SAB}valuePath`;
export const SAB_OPTION = `${SAB}option`;
export const SAB_SITE_MODEL = `${SAB}SiteModel`;
export const SAB_OPERATION = `${SAB}Operation`;
export const SAB_FLOW = `${SAB}Flow`;
/** sab:valueDatatype value meaning "emit a named node" (the contract's `'iri'`). */
export const SAB_IRI_VALUE = `${SAB}IriValue`;
/** The datatype an executor gives literals from untrusted field rules. */
export const SAB_UNTRUSTED_TEXT = `${SAB}UntrustedText`;

export const SAB_NO_SESSION = `${SAB}NoSession`;
export const SAB_SIGNED_IN = `${SAB}SignedIn`;

/** Effect classes in ascending strength. */
export const EFFECT_ORDER: readonly EffectClass[] = [
  "read",
  "reversible-write",
  "irreversible-write",
  "payment",
];

/** Contract effect class to its sab: concept. */
export const EFFECT_IRI = {
  read: `${SAB}Read`,
  "reversible-write": `${SAB}ReversibleWrite`,
  "irreversible-write": `${SAB}IrreversibleWrite`,
  payment: `${SAB}Payment`,
} as const satisfies Record<EffectClass, string>;

/** The strength rank of an effect class (0 = read). */
export function effectRank(effect: EffectClass): number {
  return EFFECT_ORDER.indexOf(effect);
}

/** The prefixes writeSiteModel and renderCatalogue use. */
export const PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  sab: SAB,
  schema: SCHEMA,
  prov: PROV,
  skos: SKOS,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
});

/** Rewrite an `http://schema.org/` IRI to the https namespace; other IRIs pass through. */
export function normaliseSchemaIri(iri: string): string {
  return iri.startsWith(SCHEMA_HTTP) ? SCHEMA + iri.slice(SCHEMA_HTTP.length) : iri;
}
