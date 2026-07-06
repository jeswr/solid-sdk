/**
 * RDF/JS query helpers over a `DatasetCore` — the shape `@jeswr/fetch-rdf`'s `parseRdf`
 * returns (only the standard `.match()` interface, NOT n3's `getSubjects`/`getObjects`
 * convenience methods). Reads go through these so every consumer uses the sanctioned parse
 * result uniformly.
 */
import type { DatasetCore, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
/** All object terms of `(subject, predicate, *)`. */
export declare function objectsOf(store: DatasetCore, subject: string, predicate: string): Quad_Object[];
/** All subject terms of `(*, predicate, object)`. */
export declare function subjectsOf(store: DatasetCore, predicate: string, object: Term | null): Quad_Subject[];
/** The first literal object value of `(subject, predicate)`. */
export declare function firstLiteralOf(store: DatasetCore, subject: string, predicate: string): string | undefined;
/** The first named-node IRI object of `(subject, predicate)`. */
export declare function firstIriOf(store: DatasetCore, subject: string, predicate: string): string | undefined;
//# sourceMappingURL=rdf-query.d.ts.map