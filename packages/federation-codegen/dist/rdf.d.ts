/**
 * RDF helpers for the generator: parse Turtle with the suite parser (`n3.Parser`),
 * query a graph through `n3.Store`, and serialise DETERMINISTICALLY with
 * `n3.Writer` (design §5 byte-reproducibility contract). No RDF is ever
 * hand-parsed or hand-concatenated — parsing is `n3.Parser`, serialisation is
 * `n3.Writer`, reads go through `Store`.
 */
import type { Quad, Term } from "@rdfjs/types";
import { Store } from "n3";
export declare const SH = "http://www.w3.org/ns/shacl#";
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export declare const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export declare const OWL = "http://www.w3.org/2002/07/owl#";
export declare const SKOS = "http://www.w3.org/2004/02/skos/core#";
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
export declare const FEDGEN = "https://w3id.org/jeswr/fedgen#";
/** Parse a Turtle string into quads via `n3.Parser` (never a bespoke parser). */
export declare function parseTurtle(ttl: string, baseIRI?: string): Quad[];
/** A read-only graph query surface over an `n3.Store`. */
export declare class Graph {
    readonly store: Store;
    constructor(quads: Iterable<Quad>);
    /** All object terms of `(subject, predicate, *)`. */
    objects(subject: Term | string, predicate: string): Term[];
    /** The single object term of `(subject, predicate, *)`, or undefined. */
    object(subject: Term | string, predicate: string): Term | undefined;
    /** The single object VALUE (string) of `(subject, predicate, *)`, or undefined. */
    value(subject: Term | string, predicate: string): string | undefined;
    /** All subject terms of `(*, predicate, object)`. */
    subjects(predicate: string, object: Term | string): Term[];
    /** Whether the graph contains `(subject, predicate, object)`. */
    has(subject: Term | string, predicate: string, object: Term | string): boolean;
    /** All distinct subjects that carry `rdf:type <typeIri>`. */
    instancesOf(typeIri: string): Term[];
}
/** A total order over quads by (subject, predicate, object) canonical keys. */
export declare function compareQuads(a: Quad, b: Quad): number;
/**
 * Serialise quads to Turtle DETERMINISTICALLY: quads are sorted by canonical key
 * and prefixes emitted in sorted order, so (given a blank-node-free graph — the
 * skolemization pass guarantees this) the output is byte-reproducible regardless
 * of input quad order. Uses `n3.Writer` (never a bespoke serializer).
 */
export declare function serializeCanonicalTurtle(quads: Iterable<Quad>, prefixes: Record<string, string>): string;
//# sourceMappingURL=rdf.d.ts.map