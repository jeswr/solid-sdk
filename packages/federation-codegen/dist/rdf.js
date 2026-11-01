// AUTHORED-BY Claude Opus 4.8
/**
 * RDF helpers for the generator: parse Turtle with the suite parser (`n3.Parser`),
 * query a graph through `n3.Store`, and serialise DETERMINISTICALLY with
 * `n3.Writer` (design §5 byte-reproducibility contract). No RDF is ever
 * hand-parsed or hand-concatenated — parsing is `n3.Parser`, serialisation is
 * `n3.Writer`, reads go through `Store`.
 */
import { DataFactory, Parser, Store, Writer } from "n3";
export const SH = "http://www.w3.org/ns/shacl#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const FEDGEN = "https://w3id.org/jeswr/fedgen#";
/** Parse a Turtle string into quads via `n3.Parser` (never a bespoke parser). */
export function parseTurtle(ttl, baseIRI) {
    return new Parser(baseIRI ? { baseIRI } : {}).parse(ttl);
}
/** A read-only graph query surface over an `n3.Store`. */
export class Graph {
    store;
    constructor(quads) {
        this.store = new Store([...quads]);
    }
    /** All object terms of `(subject, predicate, *)`. */
    objects(subject, predicate) {
        return this.store.getQuads(subject, predicate, null, null).map((q) => q.object);
    }
    /** The single object term of `(subject, predicate, *)`, or undefined. */
    object(subject, predicate) {
        return this.objects(subject, predicate)[0];
    }
    /** The single object VALUE (string) of `(subject, predicate, *)`, or undefined. */
    value(subject, predicate) {
        return this.object(subject, predicate)?.value;
    }
    /** All subject terms of `(*, predicate, object)`. */
    subjects(predicate, object) {
        return this.store.getQuads(null, predicate, object, null).map((q) => q.subject);
    }
    /** Whether the graph contains `(subject, predicate, object)`. */
    has(subject, predicate, object) {
        return this.store.getQuads(subject, predicate, object, null).length > 0;
    }
    /** All distinct subjects that carry `rdf:type <typeIri>`. */
    instancesOf(typeIri) {
        return this.subjects(`${RDF}type`, DataFactory.namedNode(typeIri));
    }
}
/** Canonical string form of a term (for stable ordering; no blank nodes expected). */
function termKey(term) {
    switch (term.termType) {
        case "NamedNode":
            return `<${term.value}>`;
        case "BlankNode":
            return `_:${term.value}`;
        case "Literal": {
            const lit = term;
            const lang = lit.language ? `@${lit.language}` : "";
            const dt = lit.datatype?.value ? `^^<${lit.datatype.value}>` : "";
            return `"${term.value}"${lang}${dt}`;
        }
        default:
            return `${term.termType}:${term.value}`;
    }
}
/** A total order over quads by (subject, predicate, object) canonical keys. */
export function compareQuads(a, b) {
    const ka = `${termKey(a.subject)} ${termKey(a.predicate)} ${termKey(a.object)}`;
    const kb = `${termKey(b.subject)} ${termKey(b.predicate)} ${termKey(b.object)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
}
/**
 * Serialise quads to Turtle DETERMINISTICALLY: quads are sorted by canonical key
 * and prefixes emitted in sorted order, so (given a blank-node-free graph — the
 * skolemization pass guarantees this) the output is byte-reproducible regardless
 * of input quad order. Uses `n3.Writer` (never a bespoke serializer).
 */
export function serializeCanonicalTurtle(quads, prefixes) {
    const sorted = [...quads].sort(compareQuads);
    const orderedPrefixes = {};
    for (const key of Object.keys(prefixes).sort()) {
        orderedPrefixes[key] = prefixes[key];
    }
    const writer = new Writer({ prefixes: orderedPrefixes });
    writer.addQuads(sorted);
    let out = "";
    writer.end((error, result) => {
        if (error)
            throw error;
        out = result;
    });
    return out;
}
//# sourceMappingURL=rdf.js.map