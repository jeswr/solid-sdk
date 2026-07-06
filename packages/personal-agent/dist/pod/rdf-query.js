import { DataFactory } from "n3";
const { namedNode } = DataFactory;
/** All object terms of `(subject, predicate, *)`. */
export function objectsOf(store, subject, predicate) {
    const out = [];
    for (const q of store.match(namedNode(subject), namedNode(predicate), null, null)) {
        out.push(q.object);
    }
    return out;
}
/** All subject terms of `(*, predicate, object)`. */
export function subjectsOf(store, predicate, object) {
    const out = [];
    for (const q of store.match(null, namedNode(predicate), object, null)) {
        out.push(q.subject);
    }
    return out;
}
/** The first literal object value of `(subject, predicate)`. */
export function firstLiteralOf(store, subject, predicate) {
    for (const object of objectsOf(store, subject, predicate)) {
        if (object.termType === "Literal")
            return object.value;
    }
    return undefined;
}
/** The first named-node IRI object of `(subject, predicate)`. */
export function firstIriOf(store, subject, predicate) {
    for (const object of objectsOf(store, subject, predicate)) {
        if (object.termType === "NamedNode")
            return object.value;
    }
    return undefined;
}
//# sourceMappingURL=rdf-query.js.map