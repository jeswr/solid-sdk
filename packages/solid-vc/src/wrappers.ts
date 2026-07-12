// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over a VC graph + the low-level GraphBuilder
// write path. This is the ONLY place RDF terms are read/written for the VC
// surface: the SDK (credentialToRdf / credentialFromRdf, the proof suites) goes
// through these wrappers / the GraphBuilder, never through hand-built quads (the
// house rule). Reading uses SetFrom.subjectPredicate; writing uses
// NamedNodeFrom/LiteralFrom/BlankNodeFrom + the dataset add.

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
  DC_CREATED,
  RDF_TYPE,
  SEC_CRYPTOSUITE,
  SEC_PROOF,
  SEC_PROOF_PURPOSE,
  SEC_PROOF_VALUE,
  SEC_VERIFICATION_METHOD,
  VC_CREDENTIAL,
  VC_CREDENTIAL_SUBJECT,
  VC_HOLDER,
  VC_ISSUER,
  VC_PRESENTATION,
  VC_VALID_FROM,
  VC_VALID_UNTIL,
  VC_VERIFIABLE_CREDENTIAL,
} from "./vocab.js";

/**
 * Read a property as a Set of the OBJECT TERMS themselves (not their lexical
 * `.value`) so the term type survives the read and the reader can reject
 * malformed objects (e.g. a literal where an IRI is required). The shared factory
 * keeps term identity / Set de-duplication consistent.
 */
function objectTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/** A typed view of a `sec:DataIntegrityProof` node. */
export class ProofNode extends TermWrapper {
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get cryptosuites(): Set<TermWrapperType> {
    return objectTerms(this, SEC_CRYPTOSUITE);
  }
  get verificationMethods(): Set<TermWrapperType> {
    return objectTerms(this, SEC_VERIFICATION_METHOD);
  }
  get proofPurposes(): Set<TermWrapperType> {
    return objectTerms(this, SEC_PROOF_PURPOSE);
  }
  get proofValues(): Set<TermWrapperType> {
    return objectTerms(this, SEC_PROOF_VALUE);
  }
  get createds(): Set<TermWrapperType> {
    return objectTerms(this, DC_CREATED);
  }
}

/** A typed view of a `cred:VerifiableCredential` node. */
export class CredentialNode extends TermWrapper {
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get issuers(): Set<TermWrapperType> {
    return objectTerms(this, VC_ISSUER);
  }
  get subjects(): Set<TermWrapperType> {
    return objectTerms(this, VC_CREDENTIAL_SUBJECT);
  }
  get validFroms(): Set<TermWrapperType> {
    return objectTerms(this, VC_VALID_FROM);
  }
  get validUntils(): Set<TermWrapperType> {
    return objectTerms(this, VC_VALID_UNTIL);
  }
  get proofs(): Set<ProofNode> {
    return SetFrom.subjectPredicate(this, SEC_PROOF, TermAs.instance(ProofNode), TermFrom.instance);
  }
}

/** A typed view of a `cred:VerifiablePresentation` node. */
export class PresentationNode extends TermWrapper {
  get types(): Set<TermWrapperType> {
    return objectTerms(this, RDF_TYPE);
  }
  get holders(): Set<TermWrapperType> {
    return objectTerms(this, VC_HOLDER);
  }
  get credentials(): Set<CredentialNode> {
    return SetFrom.subjectPredicate(
      this,
      VC_VERIFIABLE_CREDENTIAL,
      TermAs.instance(CredentialNode),
      TermFrom.instance,
    );
  }
  get proofs(): Set<ProofNode> {
    return SetFrom.subjectPredicate(this, SEC_PROOF, TermAs.instance(ProofNode), TermFrom.instance);
  }
}

/** A dataset wrapper for a VC graph. */
export class VcDataset extends DatasetWrapper {
  /** Every `cred:VerifiableCredential` subject in the dataset. */
  credentials(): CredentialNode[] {
    return [...this.instancesOf(VC_CREDENTIAL, CredentialNode)];
  }
  /** Every `cred:VerifiablePresentation` subject in the dataset. */
  presentations(): PresentationNode[] {
    return [...this.instancesOf(VC_PRESENTATION, PresentationNode)];
  }
}

/** Wrap an `RDF.DatasetCore` as a {@link VcDataset}. */
export function wrapVc(dataset: DatasetCore): VcDataset {
  return new VcDataset(dataset, DataFactory as unknown as DataFactoryType);
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

// --- the write path (GraphBuilder) ----------------------------------------

/**
 * A reference to a subject node: either a named IRI or a minted blank node, tagged
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
 * — never a hand-concatenated triple — and exposes the primitives the VC builder
 * and the proof suites need (typed IRI / literal / blank-node linking) over a
 * {@link NodeRef} so an IRI subject and a blank-node subject are never conflated.
 */
export class GraphBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /**
   * Materialise a {@link NodeRef} to its RDF/JS term. An IRI subject is passed
   * through {@link escapeIri} FIRST so an untrusted subject id cannot break out of
   * the `<…>` when the graph is serialised (n3.Writer does not escape IRIs). This
   * is scheme-agnostic, so a `urn:uuid:` / `did:` subject is preserved unchanged.
   */
  private subjectTerm(ref: NodeRef): Term {
    return ref.kind === "iri"
      ? (NamedNodeFrom.string(escapeIri(ref.value), this.factory) as unknown as Term)
      : (BlankNodeFrom.string(ref.value, this.factory) as unknown as Term);
  }

  /** Add `(subject, rdf:type, classIri)`. */
  addType(subject: NodeRef | string, classIri: string): void {
    this.addIri(subject, RDF_TYPE, classIri);
  }

  /**
   * Add `(subject, predicate, object-IRI)`. The predicate and object IRIs are
   * passed through {@link escapeIri} so neither an untrusted claim-key predicate
   * nor an untrusted object IRI can break out of the serialised `<…>` — the
   * low-level chokepoint that closes the injection for EVERY object-IRI write.
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
