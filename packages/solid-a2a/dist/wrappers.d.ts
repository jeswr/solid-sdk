import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
import { type IntentAction } from "./vocab.js";
/** A typed view of an `a2a:Parameter` node. */
export declare class ParameterNode extends TermWrapper {
    get keys(): Set<TermWrapperType>;
    get values(): Set<TermWrapperType>;
}
/**
 * A typed view of the action node linked from an intent (a schema:Action subclass
 * or an a2a: action subclass). Carries the verb's object/target/recipient/modes.
 */
export declare class ActionNode extends TermWrapper {
    /** The action's rdf:type term(s). */
    get types(): Set<TermWrapperType>;
    get objects(): Set<TermWrapperType>;
    get targets(): Set<TermWrapperType>;
    get recipients(): Set<TermWrapperType>;
    get agents(): Set<TermWrapperType>;
    get modes(): Set<TermWrapperType>;
}
/** A typed view of an `a2a:Intent` node — the request envelope. */
export declare class IntentNode extends TermWrapper {
    /** Linked action node(s), projected to typed wrappers (term-type-preserving). */
    get actions(): Set<ActionNode>;
    /** Linked parameter node(s). */
    get parameters(): Set<ParameterNode>;
    /** The intent-node-level `schema:agent` (the requester), if present. */
    get agents(): Set<TermWrapperType>;
}
/** A dataset wrapper for an intent graph. */
export declare class IntentDataset extends DatasetWrapper {
    /** Every `a2a:Intent` subject in the dataset. */
    intents(): IntentNode[];
}
/** Wrap an `RDF.DatasetCore` as an {@link IntentDataset}. */
export declare function wrapIntent(dataset: DatasetCore): IntentDataset;
/** The first NamedNode IRI value in a term set, or `undefined`. */
export declare function firstIri(terms: ReadonlySet<TermWrapperType>): string | undefined;
/** The first Literal value in a term set, or `undefined`. */
export declare function firstLiteral(terms: ReadonlySet<TermWrapperType>): string | undefined;
/** Map an action node's rdf:type term set to the intent action kind, if known. */
export declare function actionKindOf(action: ActionNode): IntentAction | undefined;
/** A `a2a:Parameter` node opened for writing. */
declare class WritableParameter extends TermWrapper {
    typeParameter(): void;
    setKey(key: string): void;
    setValue(value: string): void;
}
/** The action node (a schema:Action subclass), opened for writing. */
declare class WritableAction extends TermWrapper {
    typeAction(actionTypeIri: string): void;
    setObject(iri: string): void;
    setTarget(iri: string): void;
    setRecipient(iri: string): void;
    setAgent(iri: string): void;
    addMode(modeIri: string): void;
}
/** An `a2a:Intent` node opened for WRITING. */
declare class WritableIntent extends TermWrapper {
    typeIntent(): void;
    setAgent(iri: string): void;
    /** Link a fresh blank-node action node, typed with the action-type IRI. */
    linkAction(actionTypeIri: string): WritableAction;
    /** Link a fresh blank-node parameter node, typed `a2a:Parameter`. */
    linkParameter(): WritableParameter;
    /** Mint a blank node, link it from this subject via `predicate`, return the term. */
    private linkBlank;
}
/**
 * Builder over a fresh `N3.Store` for the intent graph. Returns the store / quads
 * so the caller can serialise it with `n3.Writer`.
 */
export declare class IntentBuilder {
    private readonly store;
    private readonly factory;
    /** Open the intent subject (`id` is the intent IRI) for writing. */
    intent(id: string): WritableIntent;
    /** Map an intent action kind to its RDF action-type IRI. */
    static actionTypeIri(action: IntentAction): string;
    /** The accumulated quads. */
    quads(): Quad[];
}
/**
 * A reference to a subject node in a {@link GraphBuilder}: either a named IRI or a
 * minted blank node. Tagged so the builder never has to GUESS whether a `string`
 * subject is an IRI or a blank-node id (the cause of an earlier IRI/blank mix-up).
 */
export type NodeRef = {
    readonly kind: "iri";
    readonly value: string;
} | {
    readonly kind: "blank";
    readonly value: string;
};
/**
 * A low-level, GENERIC quad builder over a fresh `N3.Store`, used by the SHACL
 * shape + Protocol-Document builders (which assemble standard sh:/dcterms: graphs).
 * Still goes through the factory — never a hand-concatenated triple — but exposes
 * the primitives the shape/PD builders need (typed IRI / literal / blank-node
 * linking) over a {@link NodeRef} so an IRI subject and a blank-node subject are
 * never conflated.
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
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map