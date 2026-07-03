// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Fail-closed parse guards over an RDF/JS `DatasetCore`.
 *
 * The typed `@rdfjs/wrapper` scalar accessors read a single-valued field with
 * `OptionalFrom.subjectPredicate`, which returns the FIRST matching triple and
 * silently ignores any others. The vendored diet: SHACL shape marks the model's
 * scalar fields `sh:maxCount 1` (a Meal has ONE `schema:startTime`, a Conclusion
 * ONE verdict, …), so a malformed or hostile document that carries TWO values for
 * such a field would be parsed with an ARBITRARY one — corrupting lag attribution
 * and other health decisions rather than failing closed.
 *
 * {@link assertSubjectSingletons} enforces the max-count-1 contract at parse entry,
 * but ONLY for the caller-supplied set of the ENTITY'S OWN single-valued predicates
 * — NOT every predicate on the subject. The SHACL profile is OPEN: a document may
 * legitimately carry additional/extension triples on the subject (multilingual
 * `rdfs:label`s, `owl:sameAs`, foreign metadata) that are NOT `sh:maxCount 1`, and
 * those must never invalidate the parse. Each entity parser passes exactly the
 * predicates it reads as scalars; a duplicate on one of THOSE throws, and each
 * parser body runs inside a `tryRead` guard so the throw becomes a fail-closed
 * `undefined` (the record — or, for a sub-node like a FoodItem, that node — drops).
 */
import { DataFactory } from "n3";
const { namedNode } = DataFactory;
/**
 * Throw if `subject` carries more than one object for any of the given
 * single-valued (`sh:maxCount 1`) predicates. Predicates NOT listed are ignored
 * (the model is open — they may repeat). Call at the top of an entity parser
 * (inside its `tryRead` guard) so an ambiguous document fails CLOSED instead of
 * being parsed with an arbitrary value.
 */
export function assertSubjectSingletons(dataset, subject, singletonPredicates) {
    const s = namedNode(subject);
    for (const predicate of singletonPredicates) {
        let count = 0;
        for (const _q of dataset.match(s, namedNode(predicate), null)) {
            if (++count > 1) {
                throw new Error(`duplicate value for single-valued predicate <${predicate}> on <${subject}> ` +
                    "(sh:maxCount 1) — refusing to parse an ambiguous record with an arbitrary value.");
            }
        }
    }
}
//# sourceMappingURL=rdfGuards.js.map