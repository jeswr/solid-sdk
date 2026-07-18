/**
 * Vocabulary + shape stub for the __CSD_TITLE__ walkthrough's data model.
 *
 * House rules: only REAL, dereferenceable namespaces (schema.org, W3C, …) or
 * `urn:example:` identities for local shapes — never minted http IRIs. When this
 * walkthrough grows its own vocabulary, publish it at a URL you control FIRST,
 * then reference it here (pnpm lint:iris gates dereferenceability).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Real namespaces used by the starter shapes. */
export const SCHEMA_ORG = "https://schema.org/";
export const SHACL = "http://www.w3.org/ns/shacl#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Local shape identity (RFC 6963 example URN — deliberately non-dereferenceable). */
export const PERSONA_SHAPE_IRI = "urn:example:shape:persona";

export const shapesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "shapes");
export const personaShapePath = join(shapesDir, "persona.ttl");
