import { escapeIri, safeHttpIri, safeIri } from "@jeswr/rdf-serialize";
export { escapeIri, safeHttpIri, safeIri };
/**
 * The FAIL-CLOSED wrapper of {@link safeIri}: return the safely-emittable absolute IRI,
 * or THROW a `TypeError` naming `field` when `value` cannot be safely emitted. Use for
 * a REQUIRED object IRI (an intent's `target`/`recipient`/`agent`, a SHACL response
 * class): never silently drop it, so the serialised graph cannot omit a field the
 * public object still claims (the object-desync / fail-open class).
 */
export declare function requireIri(value: string, field: string): string;
/** The FAIL-CLOSED wrapper of {@link safeHttpIri} (throws for a non-http(s) value). */
export declare function requireHttpIri(value: string, field: string): string;
//# sourceMappingURL=iri.d.ts.map