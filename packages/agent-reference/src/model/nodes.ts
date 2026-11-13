// AUTHORED-BY Codex GPT-6
/**
 * RDF views for classes rejected by federation-codegen. The exact full-model admission
 * errors are regenerated in ../generated/full-admission.json; no SHACL is weakened.
 * These views contain no cached JSON projection. Every access reads the current dataset.
 */
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri, readLiteral } from "@jeswr/model-runtime";
import { objectTerms } from "@jeswr/rdf-serialize/wrapper";
import { CredentialNode as VcCredentialNode } from "@jeswr/solid-vc";
import {
  LiteralFrom,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { MESSAGE_KINDS, type MessageKind } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const VC = "https://www.w3.org/2018/credentials#";

export class RdfNode extends TermWrapper {
  constructor(term: string | Term, dataset: Store) {
    super(checkedNode(term), dataset, DataFactory);
  }
  override get dataset(): Store {
    return super.dataset as Store;
  }
  get id(): string {
    return this.value;
  }
  protected one(predicate: string): Term | undefined {
    const values = [...objectTerms(this, predicate)];
    if (values.length > 1) throw new TypeError(`Ambiguous singleton at ${predicate}`);
    return values[0] === undefined ? undefined : TermAs.term(values[0]);
  }
  protected iri(predicate: string): string | undefined {
    const value = this.one(predicate);
    if (value === undefined) return undefined;
    if (value.termType !== "NamedNode" || !isSafeAbsoluteIri(value.value))
      throw new TypeError(`Expected one IRI at ${predicate}`);
    return value.value;
  }
  protected text(predicate: string, datatype = XSD + "string"): string | undefined {
    const value = this.one(predicate);
    if (value === undefined) return undefined;
    if (value.termType !== "Literal" || value.datatype.value !== datatype || value.language)
      throw new TypeError(`Expected ${datatype} at ${predicate}`);
    readLiteral(value);
    return value.value;
  }
  protected child<T extends RdfNode>(
    predicate: string,
    View: new (term: Term, dataset: Store) => T,
  ): T | undefined {
    const value = this.one(predicate);
    if (value === undefined) return undefined;
    if (value.termType !== "NamedNode" && value.termType !== "BlankNode")
      throw new TypeError(`Expected a node at ${predicate}`);
    return new View(value, this.dataset);
  }
  protected setIri(predicate: string, iri: string): void {
    if (!isSafeAbsoluteIri(iri)) throw new TypeError("Expected an absolute safe IRI");
    RequiredAs.object(this, predicate, iri, NamedNodeFrom.string);
  }
  protected setText(predicate: string, text: string): void {
    RequiredAs.object(this, predicate, text, LiteralFrom.string);
  }
  protected setNode(predicate: string, node: RdfNode): void {
    if (node.dataset !== this.dataset)
      throw new TypeError("Linked nodes must belong to the same dataset");
    RequiredAs.object(this, predicate, node, TermFrom.instance);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      RDF_TYPE,
      (term) => {
        if (term.termType !== "NamedNode") throw new TypeError("Expected an RDF class IRI");
        return term.value;
      },
      NamedNodeFrom.string,
    );
  }
}

/** ParticipantRef: closed shape is not admitted by the generator. */
export class ParticipantNode extends RdfNode {
  get actor(): string | undefined {
    return this.iri(AWP + "actor");
  }
  set actor(value: string) {
    this.setIri(AWP + "actor", value);
  }
  get onBehalfOf(): string | undefined {
    return this.iri("http://www.w3.org/ns/prov#actedOnBehalfOf");
  }
  set onBehalfOf(value: string) {
    this.setIri("http://www.w3.org/ns/prov#actedOnBehalfOf", value);
  }
  get operator(): string | undefined {
    return this.iri(AWP + "operator");
  }
  set operator(value: string) {
    this.setIri(AWP + "operator", value);
  }
}

/** AudienceRef: closed shape is not admitted by the generator. */
export class AudienceNode extends RdfNode {
  get actor(): string | undefined {
    return this.iri(AWP + "actor");
  }
  set actor(value: string) {
    this.setIri(AWP + "actor", value);
  }
  get party(): string | undefined {
    return this.iri(AWP + "party");
  }
  set party(value: string) {
    this.setIri(AWP + "party", value);
  }
}

/** OperationRef: closed shape is not admitted by the generator. */
export class OperationNode extends RdfNode {
  get version(): string | undefined {
    return this.text(AWP + "version");
  }
  set version(value: string) {
    this.setText(AWP + "version", value);
  }
}

/** The common typed view of the eleven closed kind-specific body shapes. */
export class BodyNode extends RdfNode {
  get want(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      AWP + "want",
      (term) => {
        if (term.termType !== "Literal" || term.datatype.value !== XSD + "string")
          throw new TypeError("Expected a requested description term");
        return term.value;
      },
      LiteralFrom.string,
    );
  }
  get operation(): OperationNode | undefined {
    return this.child(AWP + "operation", OperationNode);
  }
  set operation(value: OperationNode) {
    this.setNode(AWP + "operation", value);
  }
  get purpose(): string | undefined {
    return this.iri("https://w3id.org/dpv#hasPurpose");
  }
  set purpose(value: string) {
    this.setIri("https://w3id.org/dpv#hasPurpose", value);
  }
  get ref(): string | undefined {
    return this.iri(AWP + "ref");
  }
  set ref(value: string) {
    this.setIri(AWP + "ref", value);
  }
  get reason(): string | undefined {
    const iri = this.iri(AWP + "reason");
    return iri?.startsWith(AWP + "reason/") ? iri.slice((AWP + "reason/").length) : undefined;
  }
  get termsDigest(): string | undefined {
    return this.text(AWP + "termsDigest");
  }
  set termsDigest(value: string) {
    this.setText(AWP + "termsDigest", value);
  }
  get agreement(): string | undefined {
    return this.iri(AWP + "agreement");
  }
  set agreement(value: string) {
    this.setIri(AWP + "agreement", value);
  }
}

/** EvidenceItem: BlankNodeOrIRI and the credential link are not admitted. */
export class EvidenceNode extends RdfNode {
  get role(): string | undefined {
    const iri = this.iri(AWP + "role");
    return iri?.startsWith(AWP + "evidence-role/")
      ? iri.slice((AWP + "evidence-role/").length)
      : undefined;
  }
  get format(): string | undefined {
    return this.text(AWP + "format");
  }
  get credential(): VcCredentialNode | undefined {
    const term = this.one(VC + "verifiableCredential");
    if (!term) return undefined;
    if (term.termType !== "NamedNode" && term.termType !== "BlankNode")
      throw new TypeError("Expected an embedded credential node");
    return new VcCredentialNode(term, this.dataset, DataFactory);
  }
}

/** Message: closed envelope, kind-specific sh:node and BlankNodeOrIRI links are not admitted. */
export class MessageNode extends RdfNode {
  get profile(): string | undefined {
    return this.iri(AWP + "profile");
  }
  set profile(value: string) {
    this.setIri(AWP + "profile", value);
  }
  get configuration(): string | undefined {
    return this.iri(AWP + "configuration");
  }
  set configuration(value: string) {
    this.setIri(AWP + "configuration", value);
  }
  get conversation(): string | undefined {
    return this.iri(AWP + "conversation");
  }
  set conversation(value: string) {
    this.setIri(AWP + "conversation", value);
  }
  get kind(): MessageKind | undefined {
    const iri = this.iri(AWP + "kind");
    const code = iri?.startsWith(AWP + "kind/") ? iri.slice((AWP + "kind/").length) : undefined;
    return code && (MESSAGE_KINDS as readonly string[]).includes(code)
      ? (code as MessageKind)
      : undefined;
  }
  get from(): ParticipantNode | undefined {
    return this.child(AWP + "from", ParticipantNode);
  }
  set from(value: ParticipantNode) {
    this.setNode(AWP + "from", value);
  }
  get to(): AudienceNode | undefined {
    return this.child(AWP + "to", AudienceNode);
  }
  set to(value: AudienceNode) {
    this.setNode(AWP + "to", value);
  }
  get body(): BodyNode | undefined {
    return this.child(AWP + "body", BodyNode);
  }
  set body(value: BodyNode) {
    this.setNode(AWP + "body", value);
  }
  get createdAt(): string | undefined {
    return this.text(AWP + "createdAt", XSD + "dateTime");
  }
  get expiresAt(): string | undefined {
    return this.text(AWP + "expiresAt", XSD + "dateTime");
  }
  get evidence(): readonly EvidenceNode[] {
    return [...objectTerms(this, AWP + "evidence")].map(
      (term) => new EvidenceNode(TermAs.term(term), this.dataset),
    );
  }

  static create(id: string, kind: MessageKind, dataset = new Store()): MessageNode {
    if (!isSafeAbsoluteIri(id)) throw new TypeError("Expected an absolute safe message IRI");
    if (!(MESSAGE_KINDS as readonly string[]).includes(kind))
      throw new TypeError("Unknown message kind");
    const node = new MessageNode(id, dataset);
    node.types.add(AWP + "Message");
    node.types.add(AWP + kind[0]?.toUpperCase() + kind.slice(1));
    node.setIri(AWP + "kind", AWP + "kind/" + kind);
    return node;
  }
  setWindow(created: Date, expires: Date): void {
    if (!(created < expires)) throw new TypeError("Expected a nonempty message time window");
    RequiredAs.object(this, AWP + "createdAt", created, LiteralFrom.dateTime);
    RequiredAs.object(this, AWP + "expiresAt", expires, LiteralFrom.dateTime);
  }
}

function checkedNode(term: string | Term): Term {
  if (typeof term === "string") {
    if (!isSafeAbsoluteIri(term)) throw new TypeError("Expected an absolute safe node IRI");
    return DataFactory.namedNode(term);
  }
  if (
    term.termType !== "BlankNode" &&
    (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value))
  )
    throw new TypeError("Expected an RDF node");
  return term;
}
