/**
 * L1 (tier-a) — the STRUCTURAL admission validator (design §4). Pure JS,
 * FAIL-CLOSED, run on every generation: it refuses to generate from an ontology /
 * profile that would produce a silently-incomplete model. The reasoner (tier-b) is
 * a publish-time concern and NOT part of this module.
 *
 * Checks (scoped to the sector namespace — reused external terms are not gated):
 *   1. Every class + property carries a label AND a definition.
 *   2. Every property carries rdfs:domain + rdfs:range OR a machine-readable
 *      waiver (`fedgen:deliberatelyUnconstrained`).
 *   3. Every instance-data class has a NodeShape, every literal property in it
 *      states an explicit sh:datatype, and every property states a cardinality.
 *   4. Every closed `sh:in` enumeration is a well-formed, NON-EMPTY RDF list — an
 *      empty/malformed `sh:in` fails closed (design §4 item 4 / G2). The shape model
 *      surfaces a present-but-malformed list as an empty value set.
 */
import type { NormalizedOntology } from "./adapter.js";
import type { NormalizedShapes } from "./shapes.js";
export type AdmissionSeverity = "error" | "warning";
export interface AdmissionViolation {
    code: string;
    severity: AdmissionSeverity;
    subject: string;
    message: string;
}
export interface AdmissionReport {
    /** True when there are no ERROR-severity violations (warnings do not block). */
    ok: boolean;
    namespace: string;
    violations: AdmissionViolation[];
}
/** Thrown by {@link assertAdmitted} when the ontology / profile is not admissible. */
export declare class AdmissionError extends Error {
    readonly name = "AdmissionError";
    readonly violations: AdmissionViolation[];
    constructor(violations: AdmissionViolation[]);
}
/**
 * Run the tier-a structural checks. `namespace` scopes which terms are gated
 * (typically the ontology's `vann:preferredNamespaceUri`).
 */
export declare function admit(ontology: NormalizedOntology, shapes: NormalizedShapes, namespace: string): AdmissionReport;
/** Admit or throw {@link AdmissionError} fail-closed. */
export declare function assertAdmitted(ontology: NormalizedOntology, shapes: NormalizedShapes, namespace: string): AdmissionReport;
//# sourceMappingURL=admission.d.ts.map