import type { Quad } from "@rdfjs/types";
/** The inputs to a per-action PROV bundle (delegation profile §8). */
export interface ActionProvenanceInput {
    /** The activity IRI (`<#act>`). */
    readonly activity: string;
    /** The acting agent's WebID (`prov:wasAssociatedWith`). */
    readonly agent: string;
    /** The principal the agent acted on behalf of (`prov:actedOnBehalfOf`). Optional — omit for a direct (non-delegated) actor. */
    readonly onBehalfOf?: string;
    /** The resource(s) the activity used (`prov:used`). */
    readonly used: string | readonly string[];
    /** The artifact(s) the activity generated (`prov:generated`). Optional. */
    readonly generated?: string | readonly string[];
    /** The plan the activity was carried out under — the leaf Agreement IRI (`prov:hadPlan`). */
    readonly plan: string;
    /** The activity start instant. */
    readonly started: Date;
    /** The activity end instant. Optional. */
    readonly ended?: Date;
}
/**
 * Emit the per-action PROV activity bundle (delegation profile §8) as quads —
 * `prov:Activity` with `wasAssociatedWith` / `used` / `generated` / times and
 * a `qualifiedAssociation` naming the `hadPlan` (the leaf Agreement), plus the
 * `actedOnBehalfOf` edge and, per generated artifact, `wasDerivedFrom` the
 * used resources + `wasGeneratedBy` the activity. Built via the typed
 * {@link GraphBuilder} write path — no hand-built triples, and every IRI is
 * percent-escaped at the same chokepoint {@link delegationProvenance} uses,
 * so a hostile `agent`/`activity`/`plan`/`used`/`generated` value can never
 * inject a triple (it fails closed inside its own escaped IRI instead).
 */
export declare function actionProvenance(input: ActionProvenanceInput): Quad[];
/**
 * The JSON-LD sibling of {@link actionProvenance} — same bundle, expressed as
 * a self-contained `@graph` document (no remote `@context` dependency, same
 * rationale as `policyToJsonLd`). Every IRI-valued field is escaped through
 * the same scheme-agnostic `escapeIri` that `policyToJsonLd` already applies
 * to `delegatedUnder` (the fix that closed the delegation-chain JSON-LD
 * escaping gap, roborev Medium), so a hostile value is neutralised
 * identically in both this JSON-LD path and the RDF path above — the
 * escaping parity extends to the action bundle rather than reopening the
 * gap here.
 */
export declare function actionProvenanceJsonLd(input: ActionProvenanceInput): Record<string, unknown>;
//# sourceMappingURL=action-provenance.d.ts.map