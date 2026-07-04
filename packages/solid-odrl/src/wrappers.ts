// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over the ODRL policy graph. This is the ONLY
// place RDF terms are read/written for the ODRL surface: the SDK (policyToRdf /
// policyFromRdf) goes through these wrappers, never through hand-built quads (the
// house rule). Reading uses SetFrom.subjectPredicate; writing uses
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
import { escapeIri } from "./iri.js";
import {
  ODRL_ACTION,
  ODRL_AGREEMENT,
  ODRL_ASSIGNEE,
  ODRL_ASSIGNER,
  ODRL_CONFLICT,
  ODRL_CONSTRAINT,
  ODRL_DUTY,
  ODRL_LEFT_OPERAND,
  ODRL_OBLIGATION,
  ODRL_OFFER,
  ODRL_OPERATOR,
  ODRL_PERMISSION,
  ODRL_POLICY,
  ODRL_PROFILE,
  ODRL_PROHIBITION,
  ODRL_RIGHT_OPERAND,
  ODRL_SET,
  ODRL_TARGET,
  ODRL_UID,
  RDF_TYPE,
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

/** A typed view of an `odrl:Constraint` node. */
export class ConstraintNode extends TermWrapper {
  get leftOperands(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_LEFT_OPERAND);
  }
  get operators(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_OPERATOR);
  }
  get rightOperands(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_RIGHT_OPERAND);
  }
}

/** A typed view of an `odrl:Duty` node. */
export class DutyNode extends TermWrapper {
  get actions(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ACTION);
  }
  get targets(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_TARGET);
  }
  get constraints(): Set<ConstraintNode> {
    return SetFrom.subjectPredicate(
      this,
      ODRL_CONSTRAINT,
      TermAs.instance(ConstraintNode),
      TermFrom.instance,
    );
  }
}

/** A typed view of a Rule node (permission/prohibition). */
export class RuleNode extends TermWrapper {
  get actions(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ACTION);
  }
  get targets(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_TARGET);
  }
  get assignees(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ASSIGNEE);
  }
  get assigners(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ASSIGNER);
  }
  get constraints(): Set<ConstraintNode> {
    return SetFrom.subjectPredicate(
      this,
      ODRL_CONSTRAINT,
      TermAs.instance(ConstraintNode),
      TermFrom.instance,
    );
  }
  get duties(): Set<DutyNode> {
    return SetFrom.subjectPredicate(this, ODRL_DUTY, TermAs.instance(DutyNode), TermFrom.instance);
  }
}

/** A typed view of an `odrl:Policy` node. */
export class PolicyNode extends TermWrapper {
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get uids(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_UID);
  }
  get profiles(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_PROFILE);
  }
  get assigners(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ASSIGNER);
  }
  get assignees(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_ASSIGNEE);
  }
  get conflicts(): Set<TermWrapperType> {
    return objectTerms(this, ODRL_CONFLICT);
  }
  get permissions(): Set<RuleNode> {
    return SetFrom.subjectPredicate(
      this,
      ODRL_PERMISSION,
      TermAs.instance(RuleNode),
      TermFrom.instance,
    );
  }
  get prohibitions(): Set<RuleNode> {
    return SetFrom.subjectPredicate(
      this,
      ODRL_PROHIBITION,
      TermAs.instance(RuleNode),
      TermFrom.instance,
    );
  }
  get obligations(): Set<DutyNode> {
    return SetFrom.subjectPredicate(
      this,
      ODRL_OBLIGATION,
      TermAs.instance(DutyNode),
      TermFrom.instance,
    );
  }
}

/** A dataset wrapper for an ODRL policy graph. */
export class PolicyDataset extends DatasetWrapper {
  /** Every `odrl:Policy` (or Set/Offer/Agreement) subject in the dataset. */
  policies(): PolicyNode[] {
    const seen = new Map<string, PolicyNode>();
    for (const cls of [ODRL_POLICY, ODRL_SET, ODRL_OFFER, ODRL_AGREEMENT]) {
      for (const node of this.instancesOf(cls, PolicyNode)) {
        // De-dupe: a node typed both odrl:Set and odrl:Policy is one policy.
        seen.set(node.value, node);
      }
    }
    return [...seen.values()];
  }
}

/** Wrap an `RDF.DatasetCore` as a {@link PolicyDataset}. */
export function wrapPolicy(dataset: DatasetCore): PolicyDataset {
  return new PolicyDataset(dataset, DataFactory as unknown as DataFactoryType);
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

/** Every NamedNode IRI value in a term set. */
export function allIris(terms: ReadonlySet<TermWrapperType>): string[] {
  const out: string[] = [];
  for (const term of terms) {
    if (term.termType === "NamedNode") {
      out.push(term.value);
    }
  }
  return out;
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

/** Every value (literal or IRI) in a set, with datatype where known. */
export function allValues(
  terms: ReadonlySet<TermWrapperType>,
): Array<{ value: string; isIri: boolean; datatype?: string }> {
  const out: Array<{ value: string; isIri: boolean; datatype?: string }> = [];
  for (const term of terms) {
    if (term.termType === "Literal") {
      const dt = (term as unknown as { datatype?: { value: string } }).datatype?.value;
      out.push(
        dt !== undefined
          ? { value: term.value, isIri: false, datatype: dt }
          : { value: term.value, isIri: false },
      );
    } else if (term.termType === "NamedNode") {
      out.push({ value: term.value, isIri: true });
    }
  }
  return out;
}

// --- the write path (policyToRdf via PolicyBuilder) -----------------------

/**
 * A reference to a subject node: either a named IRI or a minted blank node. Tagged
 * so the builder never has to GUESS whether a `string` subject is an IRI or a
 * blank-node id.
 */
export type NodeRef =
  | { readonly kind: "iri"; readonly value: string }
  | { readonly kind: "blank"; readonly value: string };

/** A {@link NodeRef} for an IRI subject. */
export function iriRef(iri: string): NodeRef {
  return { kind: "iri", value: iri };
}

/** Coerce a bare IRI string to a {@link NodeRef} (a plain string is an IRI). */
function normalize(subject: NodeRef | string): NodeRef {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}

/**
 * A low-level quad builder over a fresh `N3.Store`. Goes through the RDF/JS factory
 * — never a hand-concatenated triple — and exposes the primitives the ODRL policy
 * builder needs (typed IRI / literal / blank-node linking) over a {@link NodeRef}
 * so an IRI subject and a blank-node subject are never conflated.
 */
export class GraphBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /**
   * Materialise a {@link NodeRef} to its RDF/JS term. Every IRI subject is run
   * through {@link escapeIri} FIRST, so a Turtle IRIREF-forbidden octet in an
   * untrusted subject id (e.g. a `>` in a caller-supplied policy/rule/duty id)
   * can never break out of the serialiser's `<...>` — the breakout-proof
   * chokepoint for subjects.
   */
  private subjectTerm(ref: NodeRef): Term {
    return ref.kind === "iri"
      ? (NamedNodeFrom.string(escapeIri(ref.value), this.factory) as unknown as Term)
      : (BlankNodeFrom.string(ref.value, this.factory) as unknown as Term);
  }

  /**
   * Add `(subject, predicate, object-IRI)`. Predicate and object IRI are passed
   * through {@link escapeIri} so no IRIREF-forbidden octet reaches the serialiser
   * regardless of the call site — the breakout-proof chokepoint for object IRIs.
   * (Trusted vocab constants contain no forbidden octet, so this is a no-op for
   * them; semantic http(s)-only validation lives at the call sites in policy.ts.)
   */
  addIri(subject: NodeRef | string, predicate: string, objectIri: string): void {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    const o = NamedNodeFrom.string(escapeIri(objectIri), this.factory);
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
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    const o =
      datatypeIri === undefined
        ? (LiteralFrom.string(value, this.factory) as unknown as never)
        : (this.factory.literal(
            value,
            NamedNodeFrom.string(escapeIri(datatypeIri), this.factory) as never,
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
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    this.store.add(this.factory.quad(s as never, p as never, blank as never) as Quad);
    return { kind: "blank", value: (blank as { value: string }).value };
  }

  /**
   * Link a CHILD node (a named IRI child if provided, else a fresh blank) from
   * `subject` via `predicate`, and return its {@link NodeRef}. Used for rule/duty/
   * constraint nodes which may carry their own IRI or be anonymous.
   */
  linkChild(subject: NodeRef | string, predicate: string, childIri?: string): NodeRef {
    if (childIri !== undefined) {
      this.addIri(subject, predicate, childIri);
      return iriRef(childIri);
    }
    return this.linkBlankNode(subject, predicate);
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

/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
