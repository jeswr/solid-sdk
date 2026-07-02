import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
/** A typed view of an `odrl:Constraint` node. */
export declare class ConstraintNode extends TermWrapper {
    get leftOperands(): Set<TermWrapperType>;
    get operators(): Set<TermWrapperType>;
    get rightOperands(): Set<TermWrapperType>;
}
/** A typed view of an `odrl:Duty` node. */
export declare class DutyNode extends TermWrapper {
    get actions(): Set<TermWrapperType>;
    get targets(): Set<TermWrapperType>;
    get constraints(): Set<ConstraintNode>;
}
/** A typed view of a Rule node (permission/prohibition). */
export declare class RuleNode extends TermWrapper {
    get actions(): Set<TermWrapperType>;
    get targets(): Set<TermWrapperType>;
    get assignees(): Set<TermWrapperType>;
    get assigners(): Set<TermWrapperType>;
    get constraints(): Set<ConstraintNode>;
    get duties(): Set<DutyNode>;
}
/** A typed view of an `odrl:Policy` node. */
export declare class PolicyNode extends TermWrapper {
    get types(): Set<TermWrapperType>;
    get uids(): Set<TermWrapperType>;
    get profiles(): Set<TermWrapperType>;
    get assigners(): Set<TermWrapperType>;
    get assignees(): Set<TermWrapperType>;
    get conflicts(): Set<TermWrapperType>;
    /** Delegation profile: the `odrld:delegatedUnder` parent-policy edge(s). */
    get delegatedUnders(): Set<TermWrapperType>;
    get permissions(): Set<RuleNode>;
    get prohibitions(): Set<RuleNode>;
    get obligations(): Set<DutyNode>;
}
/** A dataset wrapper for an ODRL policy graph. */
export declare class PolicyDataset extends DatasetWrapper {
    /** Every `odrl:Policy` (or Set/Offer/Agreement) subject in the dataset. */
    policies(): PolicyNode[];
}
/** Wrap an `RDF.DatasetCore` as a {@link PolicyDataset}. */
export declare function wrapPolicy(dataset: DatasetCore): PolicyDataset;
/** The first NamedNode IRI value in a term set, or `undefined`. */
export declare function firstIri(terms: ReadonlySet<TermWrapperType>): string | undefined;
/** Every NamedNode IRI value in a term set. */
export declare function allIris(terms: ReadonlySet<TermWrapperType>): string[];
/** The first Literal value in a term set, or `undefined`. */
export declare function firstLiteral(terms: ReadonlySet<TermWrapperType>): string | undefined;
/** Every value (literal or IRI) in a set, with datatype where known. */
export declare function allValues(terms: ReadonlySet<TermWrapperType>): Array<{
    value: string;
    isIri: boolean;
    datatype?: string;
}>;
/**
 * A reference to a subject node: either a named IRI or a minted blank node. Tagged
 * so the builder never has to GUESS whether a `string` subject is an IRI or a
 * blank-node id.
 */
export type NodeRef = {
    readonly kind: "iri";
    readonly value: string;
} | {
    readonly kind: "blank";
    readonly value: string;
};
/** A {@link NodeRef} for an IRI subject. */
export declare function iriRef(iri: string): NodeRef;
/**
 * A low-level quad builder over a fresh `N3.Store`. Goes through the RDF/JS factory
 * — never a hand-concatenated triple — and exposes the primitives the ODRL policy
 * builder needs (typed IRI / literal / blank-node linking) over a {@link NodeRef}
 * so an IRI subject and a blank-node subject are never conflated.
 */
export declare class GraphBuilder {
    private readonly store;
    private readonly factory;
    /** Materialise a {@link NodeRef} to its RDF/JS term. */
    private subjectTerm;
    /** Add `(subject, predicate, object-IRI)`. */
    addIri(subject: NodeRef | string, predicate: string, objectIri: string): void;
    /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
    addLiteral(subject: NodeRef | string, predicate: string, value: string, datatypeIri?: string): void;
    /**
     * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
     * {@link NodeRef} to the new blank node (so subsequent writes target it
     * unambiguously as a blank, never as an IRI).
     */
    linkBlankNode(subject: NodeRef | string, predicate: string): NodeRef;
    /**
     * Link a CHILD node (a named IRI child if provided, else a fresh blank) from
     * `subject` via `predicate`, and return its {@link NodeRef}. Used for rule/duty/
     * constraint nodes which may carry their own IRI or be anonymous.
     */
    linkChild(subject: NodeRef | string, predicate: string, childIri?: string): NodeRef;
    /** The underlying store (a DatasetCore). */
    dataset(): DatasetCore;
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map