// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over the M2 intent graph, the SHACL shapes, and
// the Protocol Document graph. This is the ONLY place RDF terms are read/written
// for those surfaces: the SDK (parseIntent / intentFromRdf / buildShapeForIntent /
// buildProtocolDocument) goes through these wrappers, never through hand-built
// quads (the house rule). Reading uses SetFrom.subjectPredicate; writing uses
// NamedNodeFrom/LiteralFrom + the dataset add, all from @rdfjs/wrapper.

import type { DataFactory as DataFactoryType, DatasetCore, Quad, Term } from "@rdfjs/types";
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
  type TermWrapper as TermWrapperType,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  A2A_ACTION,
  A2A_INTENT,
  A2A_MODE,
  A2A_PARAM_KEY,
  A2A_PARAM_VALUE,
  A2A_PARAMETER,
  A2A_PARAMETER_CLASS,
  ACTION_TYPE_IRI,
  type IntentAction,
  IRI_TO_ACTION,
  RDF_TYPE,
  SCHEMA_AGENT,
  SCHEMA_OBJECT,
  SCHEMA_RECIPIENT,
  SCHEMA_TARGET,
} from "./vocab.js";

/**
 * Read a property as a Set of the OBJECT TERMS themselves (not their lexical
 * `.value`) — so the term type survives the read and the read layer can reject
 * malformed objects (e.g. a literal where an IRI is required). The factory is
 * shared so term identity / Set de-duplication hold.
 */
function objectTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/** A typed view of an `a2a:Parameter` node. */
export class ParameterNode extends TermWrapper {
  get keys(): Set<TermWrapperType> {
    return objectTerms(this, A2A_PARAM_KEY);
  }
  get values(): Set<TermWrapperType> {
    return objectTerms(this, A2A_PARAM_VALUE);
  }
}

/**
 * A typed view of the action node linked from an intent (a schema:Action subclass
 * or an a2a: action subclass). Carries the verb's object/target/recipient/modes.
 */
export class ActionNode extends TermWrapper {
  /** The action's rdf:type term(s). */
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get objects(): Set<TermWrapperType> {
    return objectTerms(this, SCHEMA_OBJECT);
  }
  get targets(): Set<TermWrapperType> {
    return objectTerms(this, SCHEMA_TARGET);
  }
  get recipients(): Set<TermWrapperType> {
    return objectTerms(this, SCHEMA_RECIPIENT);
  }
  get agents(): Set<TermWrapperType> {
    return objectTerms(this, SCHEMA_AGENT);
  }
  get modes(): Set<TermWrapperType> {
    return objectTerms(this, A2A_MODE);
  }
}

/** A typed view of an `a2a:Intent` node — the request envelope. */
export class IntentNode extends TermWrapper {
  /** Linked action node(s), projected to typed wrappers (term-type-preserving). */
  get actions(): Set<ActionNode> {
    return SetFrom.subjectPredicate(
      this,
      A2A_ACTION,
      TermAs.instance(ActionNode),
      TermFrom.instance,
    );
  }
  /** Linked parameter node(s). */
  get parameters(): Set<ParameterNode> {
    return SetFrom.subjectPredicate(
      this,
      A2A_PARAMETER,
      TermAs.instance(ParameterNode),
      TermFrom.instance,
    );
  }
  /** The intent-node-level `schema:agent` (the requester), if present. */
  get agents(): Set<TermWrapperType> {
    return objectTerms(this, SCHEMA_AGENT);
  }
}

/** A dataset wrapper for an intent graph. */
export class IntentDataset extends DatasetWrapper {
  /** Every `a2a:Intent` subject in the dataset. */
  intents(): IntentNode[] {
    return [...this.instancesOf(A2A_INTENT, IntentNode)];
  }
}

/** Wrap an `RDF.DatasetCore` as an {@link IntentDataset}. */
export function wrapIntent(dataset: DatasetCore): IntentDataset {
  return new IntentDataset(dataset, DataFactory as unknown as DataFactoryType);
}

/** The first NamedNode IRI value in a term set, or `undefined`. */
export function firstIri(terms: ReadonlySet<TermWrapperType>): string | undefined {
  for (const term of terms) {
    if (term.termType === "NamedNode") {
      return term.value;
    }
  }
  return undefined;
}

/** The first Literal value in a term set, or `undefined`. */
export function firstLiteral(terms: ReadonlySet<TermWrapperType>): string | undefined {
  for (const term of terms) {
    if (term.termType === "Literal") {
      return term.value;
    }
  }
  return undefined;
}

/** Map an action node's rdf:type term set to the intent action kind, if known. */
export function actionKindOf(action: ActionNode): IntentAction | undefined {
  for (const type of action.types) {
    if (type.termType === "NamedNode") {
      const kind = IRI_TO_ACTION[type.value];
      if (kind !== undefined) {
        return kind;
      }
    }
  }
  return undefined;
}

// --- the write path (intentToRdf / buildShapeForIntent / buildProtocolDocument) -

/** Add a single `(subject, predicate-IRI, object-IRI)` triple through the factory. */
function addIri(node: TermWrapper, predicate: string, objectIri: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** Add a single `(subject, predicate-IRI, string-literal)` triple through the factory. */
function addLiteral(node: TermWrapper, predicate: string, value: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = LiteralFrom.string(value, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** A `a2a:Parameter` node opened for writing. */
class WritableParameter extends TermWrapper {
  typeParameter(): void {
    addIri(this, RDF_TYPE, A2A_PARAMETER_CLASS);
  }
  setKey(key: string): void {
    addLiteral(this, A2A_PARAM_KEY, key);
  }
  setValue(value: string): void {
    addLiteral(this, A2A_PARAM_VALUE, value);
  }
}

/** The action node (a schema:Action subclass), opened for writing. */
class WritableAction extends TermWrapper {
  typeAction(actionTypeIri: string): void {
    addIri(this, RDF_TYPE, actionTypeIri);
  }
  setObject(iri: string): void {
    addIri(this, SCHEMA_OBJECT, iri);
  }
  setTarget(iri: string): void {
    addIri(this, SCHEMA_TARGET, iri);
  }
  setRecipient(iri: string): void {
    addIri(this, SCHEMA_RECIPIENT, iri);
  }
  setAgent(iri: string): void {
    addIri(this, SCHEMA_AGENT, iri);
  }
  addMode(modeIri: string): void {
    addIri(this, A2A_MODE, modeIri);
  }
}

/** An `a2a:Intent` node opened for WRITING. */
class WritableIntent extends TermWrapper {
  typeIntent(): void {
    addIri(this, RDF_TYPE, A2A_INTENT);
  }
  setAgent(iri: string): void {
    addIri(this, SCHEMA_AGENT, iri);
  }

  /** Link a fresh blank-node action node, typed with the action-type IRI. */
  linkAction(actionTypeIri: string): WritableAction {
    const node = new WritableAction(this.linkBlank(A2A_ACTION), this.dataset, this.factory);
    node.typeAction(actionTypeIri);
    return node;
  }

  /** Link a fresh blank-node parameter node, typed `a2a:Parameter`. */
  linkParameter(): WritableParameter {
    const node = new WritableParameter(this.linkBlank(A2A_PARAMETER), this.dataset, this.factory);
    node.typeParameter();
    return node;
  }

  /** Mint a blank node, link it from this subject via `predicate`, return the term. */
  private linkBlank(predicate: string): Term {
    const factory = this.factory;
    const blank = BlankNodeFrom.string(undefined, factory) as Term;
    const subject = this as unknown as Term;
    const p = NamedNodeFrom.string(predicate, factory);
    this.dataset.add(factory.quad(subject as never, p as never, blank as never));
    return blank;
  }
}

/**
 * Builder over a fresh `N3.Store` for the intent graph. Returns the store / quads
 * so the caller can serialise it with `n3.Writer`.
 */
export class IntentBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /** Open the intent subject (`id` is the intent IRI) for writing. */
  intent(id: string): WritableIntent {
    const node = new WritableIntent(id, this.store as unknown as DatasetCore, this.factory);
    node.typeIntent();
    return node;
  }

  /** Map an intent action kind to its RDF action-type IRI. */
  static actionTypeIri(action: IntentAction): string {
    return ACTION_TYPE_IRI[action];
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/**
 * A reference to a subject node in a {@link GraphBuilder}: either a named IRI or a
 * minted blank node. Tagged so the builder never has to GUESS whether a `string`
 * subject is an IRI or a blank-node id (the cause of an earlier IRI/blank mix-up).
 */
export type NodeRef =
  | { readonly kind: "iri"; readonly value: string }
  | {
      readonly kind: "blank";
      readonly value: string;
    };

/** A {@link NodeRef} for an IRI subject. */
export function iriRef(iri: string): NodeRef {
  return { kind: "iri", value: iri };
}

/**
 * A low-level, GENERIC quad builder over a fresh `N3.Store`, used by the SHACL
 * shape + Protocol-Document builders (which assemble standard sh:/dcterms: graphs).
 * Still goes through the factory — never a hand-concatenated triple — but exposes
 * the primitives the shape/PD builders need (typed IRI / literal / blank-node
 * linking) over a {@link NodeRef} so an IRI subject and a blank-node subject are
 * never conflated.
 */
export class GraphBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /** Materialise a {@link NodeRef} to its RDF/JS term. */
  private subjectTerm(ref: NodeRef): Term {
    return ref.kind === "iri"
      ? (NamedNodeFrom.string(ref.value, this.factory) as unknown as Term)
      : (BlankNodeFrom.string(ref.value, this.factory) as unknown as Term);
  }

  /** Add `(subject, predicate, object-IRI)`. */
  addIri(subject: NodeRef | string, predicate: string, objectIri: string): void {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(predicate, this.factory);
    const o = NamedNodeFrom.string(objectIri, this.factory);
    this.store.add(this.factory.quad(s as never, p as never, o as never) as Quad);
  }

  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(
    subject: NodeRef | string,
    predicate: string,
    value: string,
    datatypeIri?: string,
  ): void {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(predicate, this.factory);
    const o =
      datatypeIri === undefined
        ? (LiteralFrom.string(value, this.factory) as unknown as never)
        : (this.factory.literal(
            value,
            NamedNodeFrom.string(datatypeIri, this.factory) as never,
          ) as never);
    this.store.add(this.factory.quad(s as never, p as never, o as never) as Quad);
  }

  /**
   * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
   * {@link NodeRef} to the new blank node (so subsequent writes target it
   * unambiguously as a blank, never as an IRI).
   */
  linkBlankNode(subject: NodeRef | string, predicate: string): NodeRef {
    const s = this.subjectTerm(normalize(subject));
    const blank = BlankNodeFrom.string(undefined, this.factory) as unknown as Term;
    const p = NamedNodeFrom.string(predicate, this.factory);
    this.store.add(this.factory.quad(s as never, p as never, blank as never) as Quad);
    return { kind: "blank", value: (blank as { value: string }).value };
  }

  /** The underlying store (a DatasetCore). */
  dataset(): DatasetCore {
    return this.store as unknown as DatasetCore;
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/** Coerce a bare IRI string to a {@link NodeRef} (a plain string is an IRI). */
function normalize(subject: NodeRef | string): NodeRef {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}

/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
