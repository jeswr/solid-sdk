import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
/** A typed view of a `sec:DataIntegrityProof` node. */
export declare class ProofNode extends TermWrapper {
    get types(): Set<TermWrapperType>;
    get cryptosuites(): Set<TermWrapperType>;
    get verificationMethods(): Set<TermWrapperType>;
    get proofPurposes(): Set<TermWrapperType>;
    get proofValues(): Set<TermWrapperType>;
    get createds(): Set<TermWrapperType>;
}
/** A typed view of a `cred:VerifiableCredential` node. */
export declare class CredentialNode extends TermWrapper {
    get types(): Set<TermWrapperType>;
    get issuers(): Set<TermWrapperType>;
    get subjects(): Set<TermWrapperType>;
    get validFroms(): Set<TermWrapperType>;
    get validUntils(): Set<TermWrapperType>;
    get proofs(): Set<ProofNode>;
}
/** A typed view of a `cred:VerifiablePresentation` node. */
export declare class PresentationNode extends TermWrapper {
    get types(): Set<TermWrapperType>;
    get holders(): Set<TermWrapperType>;
    get credentials(): Set<CredentialNode>;
    get proofs(): Set<ProofNode>;
}
/** A dataset wrapper for a VC graph. */
export declare class VcDataset extends DatasetWrapper {
    /** Every `cred:VerifiableCredential` subject in the dataset. */
    credentials(): CredentialNode[];
    /** Every `cred:VerifiablePresentation` subject in the dataset. */
    presentations(): PresentationNode[];
}
/** Wrap an `RDF.DatasetCore` as a {@link VcDataset}. */
export declare function wrapVc(dataset: DatasetCore): VcDataset;
/** The first NamedNode IRI value in a term set, or `undefined`. */
export declare function firstIri(terms: ReadonlySet<TermWrapperType>): string | undefined;
/** The first Literal value in a term set, or `undefined`. */
export declare function firstLiteral(terms: ReadonlySet<TermWrapperType>): string | undefined;
/**
 * A reference to a subject node: either a named IRI or a minted blank node, tagged
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
 * — never a hand-concatenated triple — and exposes the primitives the VC builder
 * and the proof suites need (typed IRI / literal / blank-node linking) over a
 * {@link NodeRef} so an IRI subject and a blank-node subject are never conflated.
 */
export declare class GraphBuilder {
    private readonly store;
    private readonly factory;
    /**
     * Materialise a {@link NodeRef} to its RDF/JS term. An IRI subject is passed
     * through {@link escapeIri} FIRST so an untrusted subject id cannot break out of
     * the `<…>` when the graph is serialised (n3.Writer does not escape IRIs). This
     * is scheme-agnostic, so a `urn:uuid:` / `did:` subject is preserved unchanged.
     */
    private subjectTerm;
    /** Add `(subject, rdf:type, classIri)`. */
    addType(subject: NodeRef | string, classIri: string): void;
    /**
     * Add `(subject, predicate, object-IRI)`. The predicate and object IRIs are
     * passed through {@link escapeIri} so neither an untrusted claim-key predicate
     * nor an untrusted object IRI can break out of the serialised `<…>` — the
     * low-level chokepoint that closes the injection for EVERY object-IRI write.
     */
    addIri(subject: NodeRef | string, predicate: string, objectIri: string): void;
    /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
    addLiteral(subject: NodeRef | string, predicate: string, value: string, datatypeIri?: string): void;
    /**
     * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
     * {@link NodeRef} to the new blank node (so subsequent writes target it
     * unambiguously as a blank, never as an IRI).
     */
    linkBlankNode(subject: NodeRef | string, predicate: string): NodeRef;
    /** The underlying store (a DatasetCore). */
    dataset(): DatasetCore;
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map