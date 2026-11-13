// AUTHORED-BY Codex GPT-6
/** Live RDF views. Protocol adapters construct these; gates never inspect protocol JSON. */
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { digestOf } from "../core/canonical.js";
import type { ActionIntent, Agreement } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { OperationNode, ParticipantNode, RdfNode } from "./nodes.js";
export const SCHEMA = "https://schema.org/";
export const ODRL = "http://www.w3.org/ns/odrl/2/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
export interface PaymentData {
  id: string;
  agreement: string;
  payer: string;
  payee: string;
  account: string;
  amount: string;
  currency: string;
  invoice: string;
  onceKey: string;
  validUntil: string;
  instalment: number;
}
export interface DueData {
  instalment?: number;
  payer?: string;
  purpose?: string;
  digest: string;
  service: string;
  payee: string;
  amount: string;
  currency: string;
  validFrom: string;
  validUntil: string;
  offerProof: string;
  acceptanceProof: string;
}
class PaymentNode extends RdfNode {
  decimal(predicate: string, value: string): void {
    if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new TypeError("Expected decimal money");
    RequiredAs.object(this, predicate, value, (text) =>
      DataFactory.literal(text, DataFactory.namedNode(XSD + "decimal")),
    );
  }
  time(predicate: string, value: string): void {
    if (!Number.isFinite(Date.parse(value))) throw new TypeError("Expected payment time");
    RequiredAs.object(this, predicate, value, (text) =>
      DataFactory.literal(text, DataFactory.namedNode(XSD + "dateTime")),
    );
  }
}
export class CompensationNode extends PaymentNode {
  get constraint(): PaymentConstraintNode | undefined {
    return this.child(ODRL + "constraint", PaymentConstraintNode);
  }
  get payee(): string | undefined {
    return this.iri(ODRL + "compensatedParty");
  }
  get action(): string | undefined {
    return this.iri(ODRL + "action");
  }
  initialise(data: DueData): void {
    this.types.add(ODRL + "Duty");
    this.setIri(ODRL + "action", ODRL + "compensate");
    this.setIri(ODRL + "compensatedParty", data.payee);
    const constraint = new PaymentConstraintNode(this.id + ":amount", this.dataset);
    constraint.initialise(data);
    this.setNode(ODRL + "constraint", constraint);
  }
}
export class PaymentConstraintNode extends PaymentNode {
  get amount(): string | undefined {
    return this.text(ODRL + "rightOperand", XSD + "decimal");
  }
  get currency(): string | undefined {
    return this.text(ODRL + "unit");
  }
  get operand(): string | undefined {
    return this.iri(ODRL + "leftOperand");
  }
  initialise(data: DueData): void {
    this.types.add(ODRL + "Constraint");
    this.setIri(ODRL + "leftOperand", ODRL + "payAmount");
    this.setIri(ODRL + "operator", ODRL + "eq");
    this.decimal(ODRL + "rightOperand", data.amount);
    this.setText(ODRL + "unit", data.currency);
  }
}
export class PaymentOfferNode extends PaymentNode {
  get service(): string | undefined {
    return this.text(SCHEMA + "name");
  }
  get payer(): string | undefined {
    return this.iri(SCHEMA + "agent");
  }
  get purpose(): string | undefined {
    return this.iri("https://w3id.org/dpv#hasPurpose");
  }
  get validFrom(): string | undefined {
    return this.timeLexical(AWP + "validFrom");
  }
  get validUntil(): string | undefined {
    return this.timeLexical(AWP + "validUntil");
  }
  get instalment(): number {
    return Number(this.text(AWP + "instalment") ?? "1");
  }
  get duty(): CompensationNode | undefined {
    return this.child(ODRL + "duty", CompensationNode);
  }
  static create(data: DueData): PaymentOfferNode {
    const node = new PaymentOfferNode(
      `urn:awp:offer:${encodeURIComponent(data.digest)}`,
      new Store(),
    );
    node.types.add(ODRL + "Offer");
    node.setText(SCHEMA + "name", data.service);
    node.time(AWP + "validFrom", data.validFrom);
    node.time(AWP + "validUntil", data.validUntil);
    node.setText(AWP + "instalment", String(data.instalment ?? 1));
    if (data.payer) node.setIri(SCHEMA + "agent", data.payer);
    if (data.purpose) node.setIri("https://w3id.org/dpv#hasPurpose", data.purpose);
    const duty = new CompensationNode(node.id + ":duty", node.dataset);
    duty.initialise(data);
    node.setNode(ODRL + "duty", duty);
    const permission = new PaymentNode(node.id + ":permission", node.dataset);
    permission.types.add(ODRL + "Permission");
    RequiredAs.object(permission, ODRL + "action", ODRL + "use", DataFactory.namedNode);
    const service = new PaymentNode(node.id + ":service", node.dataset);
    RequiredAs.object(service, SCHEMA + "name", data.service, (v) => DataFactory.literal(v));
    RequiredAs.object(permission, ODRL + "target", service, TermFrom.instance);
    node.setNode(ODRL + "permission", permission);
    return node;
  }
}

export class PaymentAgreementNode extends PaymentNode {
  get payer(): string | undefined {
    return this.iri(SCHEMA + "agent");
  }
  get purpose(): string | undefined {
    return this.iri("https://w3id.org/dpv#hasPurpose");
  }
  get digest(): string | undefined {
    return this.text(AWP + "termsDigest");
  }
  get service(): string | undefined {
    return this.text(SCHEMA + "name");
  }
  get validFrom(): string | undefined {
    return this.timeLexical(AWP + "validFrom");
  }
  get validUntil(): string | undefined {
    return this.timeLexical(AWP + "validUntil");
  }
  get offerProof(): string | undefined {
    return this.text(AWP + "offerProof");
  }
  get acceptanceProof(): string | undefined {
    return this.text(AWP + "acceptanceProof");
  }
  get instalment(): number {
    return Number(this.text(AWP + "instalment") ?? "1");
  }
  get duty(): CompensationNode | undefined {
    return this.child(ODRL + "duty", CompensationNode);
  }
  static create(data: DueData, sourceOffer?: PaymentOfferNode): PaymentAgreementNode {
    const node = new PaymentAgreementNode(
      agreementIri(data.digest),
      new Store(sourceOffer ? [...sourceOffer.dataset] : []),
    );
    node.types.add(ODRL + "Agreement");
    if (data.payer) node.setIri(SCHEMA + "agent", data.payer);
    if (data.purpose) node.setIri("https://w3id.org/dpv#hasPurpose", data.purpose);
    node.setText(AWP + "termsDigest", data.digest);
    node.setText(AWP + "instalment", String(data.instalment ?? 1));
    node.setText(SCHEMA + "name", data.service);
    node.time(AWP + "validFrom", data.validFrom);
    node.time(AWP + "validUntil", data.validUntil);
    node.setText(AWP + "offerProof", data.offerProof);
    node.setText(AWP + "acceptanceProof", data.acceptanceProof);
    if (sourceOffer?.duty) {
      node.setIri(ODRL + "duty", sourceOffer.duty.id);
      node.setIri("http://www.w3.org/ns/prov#wasDerivedFrom", sourceOffer.id);
      return node;
    }
    const duty = new CompensationNode(node.id + ":duty", node.dataset);
    duty.initialise(data);
    node.setNode(ODRL + "duty", duty);
    const offer = new PaymentNode(node.id + ":offer", node.dataset);
    offer.types.add(ODRL + "Offer");
    // The exact same compensation duty is preserved in the offer and agreement.
    RequiredAs.object(offer, ODRL + "duty", duty, TermFrom.instance);
    const permission = new PaymentNode(node.id + ":service", node.dataset);
    permission.types.add(ODRL + "Permission");
    RequiredAs.object(permission, ODRL + "action", ODRL + "use", DataFactory.namedNode);
    const service = new PaymentNode(node.id + ":service-description", node.dataset);
    RequiredAs.object(service, SCHEMA + "name", data.service, (value) =>
      DataFactory.literal(value),
    );
    RequiredAs.object(permission, ODRL + "target", service, TermFrom.instance);
    RequiredAs.object(offer, ODRL + "permission", permission, TermFrom.instance);
    RequiredAs.object(node, "http://www.w3.org/ns/prov#wasDerivedFrom", offer, TermFrom.instance);
    return node;
  }
  /** Explicit adapter for the engine's retained legacy agreement record, never foreign bytes. */
  static fromRecord(
    record: Agreement,
    proofs: { offer: string; acceptance: string; offerNode?: PaymentOfferNode },
  ): PaymentAgreementNode | undefined {
    const terms = record.terms;
    const due = terms.compensation;
    if (
      !due ||
      typeof due !== "object" ||
      Array.isArray(due) ||
      typeof due.amount !== "string" ||
      typeof due.currency !== "string" ||
      typeof due.payee !== "string" ||
      typeof terms.service !== "string" ||
      typeof terms.validUntil !== "string"
    )
      return undefined;
    const source = proofs.offerNode;
    const node = PaymentAgreementNode.create(
      {
        payer: record.acceptor.onBehalfOf,
        purpose: typeof terms.purpose === "string" ? terms.purpose : undefined,
        digest: record.termsDigest,
        service: source?.service ?? terms.service,
        payee: source?.duty?.payee ?? due.payee,
        amount: source?.duty?.constraint?.amount ?? due.amount,
        currency: source?.duty?.constraint?.currency ?? due.currency,
        validFrom: source?.validFrom ?? String(terms.validFrom ?? record.formedAt),
        validUntil: source?.validUntil ?? terms.validUntil,
        offerProof: proofs.offer,
        acceptanceProof: proofs.acceptance,
        instalment: source?.instalment ?? (typeof due.instalment === "number" ? due.instalment : 1),
      },
      source,
    );
    node.setIri(AWP + "conversation", record.conversation);
    const operation = new OperationNode(record.operation.id, node.dataset);
    operation.types.add(AWP + "OperationRef");
    operation.version = record.operation.version;
    node.setNode(AWP + "operation", operation);
    node.setIri(AWP + "offer", record.offer);
    node.setIri(AWP + "acceptance", record.acceptance);
    const termsNode = new PaymentNode(node.id + ":terms", node.dataset);
    node.setNode(AWP + "terms", termsNode);
    for (const [field, value] of [
      ["offeror", record.offeror],
      ["acceptor", record.acceptor],
    ] as const) {
      const party = new ParticipantNode(node.id + ":" + field, node.dataset);
      party.types.add(AWP + "ParticipantRef");
      if (value.actor) party.actor = value.actor;
      if (value.onBehalfOf) party.onBehalfOf = value.onBehalfOf;
      node.setNode(AWP + field, party);
    }
    node.time(AWP + "formedAt", record.formedAt);
    return node;
  }
}
export function agreementIri(digest: string): string {
  return `urn:awp:payment-agreement:${encodeURIComponent(digest)}`;
}
export function paymentOnceKey(digest: string, instalment: number): string {
  return digestOf({ termsDigest: digest, instalment });
}
export class PaymentFacts extends PaymentNode {
  get heldAgreement(): PaymentAgreementNode | undefined {
    return this.child(AWP + "agreement", PaymentAgreementNode);
  }
  attachAgreement(agreement: PaymentAgreementNode): void {
    this.dataset.addQuads([...agreement.dataset]);
    this.setIri(AWP + "agreement", agreement.id);
  }
  get agreement(): string | undefined {
    return this.text(AWP + "settles");
  }
  get payer(): string | undefined {
    return this.iri(SCHEMA + "agent");
  }
  get payee(): string | undefined {
    return this.iri(SCHEMA + "recipient");
  }
  get account(): string | undefined {
    return this.iri(AWP + "payeeAccount");
  }
  get amount(): string | undefined {
    return (
      this.text(SCHEMA + "price", XSD + "decimal") ??
      this.text(SCHEMA + "totalPaymentDue", XSD + "decimal")
    );
  }
  get currency(): string | undefined {
    return this.text(SCHEMA + "priceCurrency");
  }
  get invoice(): string | undefined {
    return this.iri(SCHEMA + "object");
  }
  get onceKey(): string | undefined {
    return this.text(AWP + "onceKey");
  }
  get validUntil(): string | undefined {
    return this.timeLexical(AWP + "validUntil");
  }
  get instalment(): number {
    return Number(this.text(AWP + "instalment"));
  }
  get order(): string | undefined {
    return this.iri(SCHEMA + "about");
  }
  get status(): string | undefined {
    return this.iri(SCHEMA + "actionStatus");
  }
  get ledgerReference(): string | undefined {
    return this.text(SCHEMA + "confirmationNumber");
  }
  get provider(): string | undefined {
    return this.iri("http://www.w3.org/ns/prov#wasAttributedTo");
  }
  get kind(): string | undefined {
    return this.text(AWP + "claimType");
  }
  fingerprint(): string {
    return digestOf(
      [...this.dataset].map((quad) =>
        [quad.subject, quad.predicate, quad.object, quad.graph].map((term) => [
          term.termType,
          term.value,
          ...(term.termType === "Literal" ? [term.datatype.value, term.language] : []),
        ]),
      ),
    );
  }
  snapshot(): PaymentFacts {
    return new PaymentFacts(this.id, new Store([...this.dataset]));
  }
  data(): PaymentData {
    const {
      id,
      agreement,
      payer,
      payee,
      account,
      amount,
      currency,
      invoice,
      onceKey,
      validUntil,
      instalment,
    } = this;
    if (
      !agreement ||
      !payer ||
      !payee ||
      !account ||
      !amount ||
      !currency ||
      !invoice ||
      !onceKey ||
      !validUntil
    )
      throw new TypeError("Incomplete payment");
    return {
      id,
      agreement,
      payer,
      payee,
      account,
      amount,
      currency,
      invoice,
      onceKey,
      validUntil,
      instalment,
    };
  }
  static invoiceFor(data: {
    id: string;
    agreement: string;
    payee: string;
    amount: string;
    currency: string;
    dueDate: string;
    account: string;
  }): PaymentFacts {
    const node = new PaymentFacts(data.id, new Store());
    node.types.add(SCHEMA + "Invoice");
    node.setText(AWP + "settles", data.agreement);
    node.setIri(SCHEMA + "referencesOrder", agreementIri(data.agreement));
    node.setIri(SCHEMA + "recipient", data.payee);
    node.setIri(AWP + "payeeAccount", data.account);
    node.decimal(SCHEMA + "totalPaymentDue", data.amount);
    node.setText(SCHEMA + "priceCurrency", data.currency);
    node.time(SCHEMA + "paymentDueDate", data.dueDate);
    return node;
  }
  static create(data: PaymentData): PaymentFacts {
    const node = new PaymentFacts(data.id, new Store());
    node.types.add(SCHEMA + "PayAction");
    node.setText(AWP + "settles", data.agreement);
    node.setIri(SCHEMA + "agent", data.payer);
    node.setIri(SCHEMA + "recipient", data.payee);
    node.setIri(AWP + "payeeAccount", data.account);
    node.decimal(SCHEMA + "price", data.amount);
    node.setText(SCHEMA + "priceCurrency", data.currency);
    node.setIri(SCHEMA + "object", data.invoice);
    node.setText(AWP + "onceKey", data.onceKey);
    node.time(AWP + "validUntil", data.validUntil);
    node.setText(AWP + "instalment", String(data.instalment));
    return node;
  }
  static fromIntent(intent: ActionIntent, payer: string, _at: string): PaymentFacts {
    const p = intent.parameters;
    const node = new PaymentFacts(
      `urn:awp:payment:${digestOf(intent).replace(":", "-")}`,
      new Store(),
    );
    node.types.add(SCHEMA + "PayAction");
    node.setIri(SCHEMA + "agent", payer);
    for (const [field, predicate] of [
      ["payee", SCHEMA + "recipient"],
      ["account", AWP + "payeeAccount"],
      ["reference", SCHEMA + "object"],
    ] as const)
      if (typeof p[field] === "string" && isSafeAbsoluteIri(String(p[field])))
        node.setIri(predicate, String(p[field]));
    if (typeof p.amount === "number" || typeof p.amount === "string") {
      const text = String(p.amount);
      if (/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) node.decimal(SCHEMA + "price", text);
    }
    if (typeof p.currency === "string") node.setText(SCHEMA + "priceCurrency", p.currency);
    if (typeof p.agreement === "string") node.setText(AWP + "settles", p.agreement);
    const instalment = typeof p.instalment === "number" ? p.instalment : 1;
    node.setText(AWP + "instalment", String(instalment));
    node.setText(
      AWP + "onceKey",
      typeof p.onceKey === "string"
        ? p.onceKey
        : paymentOnceKey(String(p.agreement ?? ""), instalment),
    );
    if (typeof p.validUntil === "string" && Number.isFinite(Date.parse(p.validUntil)))
      node.time(AWP + "validUntil", p.validUntil);
    return node;
  }
  static receipt(order: PaymentFacts, provider: string, reference: string): PaymentFacts {
    const node = new PaymentFacts(
      order.id + ":receipt",
      new Store([...PaymentFacts.create(order.data()).dataset]),
    );
    node.types.add(AWP + "PaymentReceipt");
    node.setText(AWP + "claimType", "payment-receipt");
    node.setIri(SCHEMA + "about", order.id);
    node.setIri(SCHEMA + "actionStatus", SCHEMA + "CompletedActionStatus");
    node.setText(SCHEMA + "confirmationNumber", reference);
    node.setIri("http://www.w3.org/ns/prov#wasAttributedTo", provider);
    for (const pred of [
      AWP + "settles",
      SCHEMA + "recipient",
      SCHEMA + "price",
      SCHEMA + "priceCurrency",
    ])
      for (const quad of order.dataset.getQuads(
        DataFactory.namedNode(order.id),
        DataFactory.namedNode(pred),
        null,
        null,
      ))
        RequiredAs.object(node, pred, quad.object, (value) => value);
    // Keep only nodes reachable from the receipt; the order is linked with schema:about.
    return node;
  }
}

export class PaymentAccountNode extends RdfNode {
  get payee(): string | undefined {
    return this.iri(SCHEMA + "recipient");
  }
  get account(): string | undefined {
    return this.iri(AWP + "payeeAccount");
  }
  static create(payee: string, account: string): PaymentAccountNode {
    const node = new PaymentAccountNode("urn:awp:accepted-account-binding", new Store());
    node.setIri(SCHEMA + "recipient", payee);
    node.setIri(AWP + "payeeAccount", account);
    return node;
  }
}
