// AUTHORED-BY Codex GPT-6
/** Live credential/subject metadata views. Legacy ingress may supply only a projection. */
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { RequiredAs } from "@rdfjs/wrapper";
import { Store } from "n3";
import { AWP } from "../profile/vocabulary.js";
import { type NamedValuesNode, namedValuesOf } from "./named-values.js";
import { RdfNode } from "./nodes.js";

const XSD = "http://www.w3.org/2001/XMLSchema#";
const VC = "https://www.w3.org/2018/credentials#";
const PROV = "http://www.w3.org/ns/prov#";
const SCHEMA = "https://schema.org/";
const TEMPORAL = "http://purl.org/dc/terms/temporal";

export interface QualityInput {
  readonly issuer?: string;
  readonly subject?: string;
  readonly claimType: string;
  readonly method?: string;
  readonly asOf?: string;
  readonly issuedAt?: string;
  readonly period?: { readonly start: string; readonly end: string };
  readonly validUntil?: string;
}

function setInstant(node: RdfNode, predicate: string, value: string | undefined): void {
  if (value !== undefined)
    RequiredAs.object(node, predicate, value, (lexical) =>
      node.factory.literal(lexical, node.factory.namedNode(XSD + "dateTime")),
    );
}

/** VC shape's BlankNodeOrIRI subject/proof links are rejected by codegen. */
export class StatementQualityNode extends RdfNode {
  get issuer(): string | undefined {
    return this.iri(VC + "issuer");
  }
  get claimSubject(): string | undefined {
    const subject = this.claims;
    return subject.termType === "NamedNode" ? subject.value : undefined;
  }
  get claims(): QualitySubjectNode {
    const subject = this.child(VC + "credentialSubject", QualitySubjectNode);
    if (!subject) throw new TypeError("Missing credential subject");
    return subject;
  }
  get claimType(): string {
    return this.claims.claimType;
  }
  get method(): string | undefined {
    return this.claims.method;
  }
  get asOf(): string | undefined {
    return this.claims.asOf;
  }
  get period(): StatementPeriodNode | undefined {
    return this.claims.period;
  }
  get issuedAt(): string | undefined {
    return this.timeLexical(PROV + "generatedAtTime");
  }
  get validUntil(): string | undefined {
    return this.timeLexical(VC + "validUntil");
  }

  static from(input: QualityInput | StatementQualityNode): StatementQualityNode {
    if (input instanceof StatementQualityNode) return input;
    const values = namedValuesOf(input);
    if (values) return new PayloadQualityNode(values);
    const node = new StatementQualityNode("urn:awp:statement-quality", new Store());
    node.types.add(VC + "VerifiableCredential");
    // A metadata-only derived input may not name its issuer. Do not invent one: that
    // partial graph is usable for its local fitness check, but fails full VC admission.
    if (input.issuer && isSafeAbsoluteIri(input.issuer)) node.setIri(VC + "issuer", input.issuer);
    const subjectId =
      input.subject && isSafeAbsoluteIri(input.subject) ? input.subject : node.factory.blankNode();
    const subject = new QualitySubjectNode(subjectId, node.dataset);
    subject.types.add(AWP + "StatementSubject");
    subject.claimType = input.claimType;
    if (input.method !== undefined) subject.method = input.method;
    subject.asOf = input.asOf;
    node.setNode(VC + "credentialSubject", subject);
    setInstant(node, PROV + "generatedAtTime", input.issuedAt);
    setInstant(node, VC + "validUntil", input.validUntil);
    if (input.period) {
      const period = new StatementPeriodNode("urn:awp:statement-quality:period", node.dataset);
      period.types.add("http://purl.org/dc/terms/PeriodOfTime");
      period.start = input.period.start;
      period.end = input.period.end;
      subject.period = period;
    }
    return node;
  }
}

/** Subject shape's value/terms/period links are rejected by codegen. */
export class QualitySubjectNode extends RdfNode {
  get claimType(): string {
    return this.text(AWP + "claimType") ?? "";
  }
  set claimType(value: string) {
    this.setText(AWP + "claimType", value);
  }
  get method(): string | undefined {
    return this.text(AWP + "method");
  }
  set method(value: string) {
    this.setText(AWP + "method", value);
  }
  get asOf(): string | undefined {
    return this.timeLexical(AWP + "asOf");
  }
  set asOf(value: string | undefined) {
    setInstant(this, AWP + "asOf", value);
  }
  get period(): StatementPeriodNode | undefined {
    return this.child(TEMPORAL, StatementPeriodNode);
  }
  set period(value: StatementPeriodNode) {
    this.setNode(TEMPORAL, value);
  }
}

/** Closed/ignored-properties constraints are rejected by codegen. */
export class StatementPeriodNode extends RdfNode {
  get start(): string {
    return this.text(SCHEMA + "startDate") ?? "";
  }
  set start(value: string) {
    this.setText(SCHEMA + "startDate", value);
  }
  get end(): string {
    return this.text(SCHEMA + "endDate") ?? "";
  }
  set end(value: string) {
    this.setText(SCHEMA + "endDate", value);
  }
}

/** Metadata in a complete retained-JWS credential is read from its admitted named values.
 * No second metadata graph is constructed, so changes remain visible to the gate.
 */
class PayloadQualityNode extends StatementQualityNode {
  constructor(private readonly values: NamedValuesNode) {
    super(values.id, values.dataset);
  }
  private field(name: string): string | undefined {
    const value = (this.values.live as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  }
  override get issuer(): string | undefined {
    const issuer = this.field("issuer");
    return issuer && isSafeAbsoluteIri(issuer) ? issuer : undefined;
  }
  override get claimSubject(): string | undefined {
    const subject = this.field("subject");
    return subject && isSafeAbsoluteIri(subject) ? subject : undefined;
  }
  override get claims(): QualitySubjectNode {
    return new PayloadSubjectNode(this.values);
  }
  override get issuedAt(): string | undefined {
    return this.field("issuedAt");
  }
  override get validUntil(): string | undefined {
    return this.field("validUntil");
  }
}

class PayloadSubjectNode extends QualitySubjectNode {
  constructor(private readonly values: NamedValuesNode) {
    super(values.id, values.dataset);
  }
  private field(name: string): string | undefined {
    const value = (this.values.live as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  }
  override get claimType(): string {
    return this.field("claimType") ?? "";
  }
  override get method(): string | undefined {
    return this.field("method");
  }
  override get asOf(): string | undefined {
    return this.field("asOf");
  }
  override get period(): StatementPeriodNode | undefined {
    const values = namedValuesOf((this.values.live as Record<string, unknown>).period);
    return values ? new PayloadPeriodNode(values) : undefined;
  }
}
class PayloadPeriodNode extends StatementPeriodNode {
  constructor(private readonly values: NamedValuesNode) {
    super(values.id, values.dataset);
  }
  override get start(): string {
    return String((this.values.live as Record<string, unknown>).start ?? "");
  }
  override get end(): string {
    return String((this.values.live as Record<string, unknown>).end ?? "");
  }
}
