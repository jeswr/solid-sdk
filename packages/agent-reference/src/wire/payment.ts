// AUTHORED-BY Codex GPT-6
/** The only boundary at which foreign RDF settlement objects are parsed. */

import { BoundsError } from "../core/limits.js";
import { ODRL, PaymentFacts, SCHEMA } from "../model/payment.js";
import type { ProtocolObjects, SettlementTrace } from "../settlement/types.js";
import { readAttachmentDocument, writeAttachmentDocument } from "./attachments.js";
import { readDocument, writeDocument } from "./document.js";

export async function paymentDocument(
  facts: PaymentFacts,
): Promise<import("./document.js").JsonLdDocument> {
  try {
    return await writeDocument(facts);
  } catch (error) {
    if (!(error instanceof BoundsError)) throw error;
    const packet = await writeAttachmentDocument(facts);
    return {
      format: "awp-rdf-packet/0.1",
      jsonld: JSON.stringify(packet.document),
      attachments: packet.attachments,
    };
  }
}
export async function paymentObjects(facts: PaymentFacts, name: string): Promise<ProtocolObjects> {
  const document = await paymentDocument(facts);
  return {
    suite: "rdf-order",
    objects: [{ name, form: "application/ld+json", shown: document }],
    native: { facts, documentDigest: digestOf(document) },
  };
}
export async function readPaymentObjects(value: unknown): Promise<ProtocolObjects> {
  const packet = value as {
    format?: string;
    jsonld?: string;
    attachments?: import("./attachments.js").DocumentAttachment[];
  };
  const result =
    packet?.format === "awp-rdf-packet/0.1" &&
    typeof packet.jsonld === "string" &&
    Array.isArray(packet.attachments)
      ? await readAttachmentDocument(packet.jsonld, packet.attachments)
      : await readDocument(JSON.stringify(value), "application/ld+json");
  if (!result.ok) throw new TypeError(`Payment RDF refused: ${result.detail}`);
  return {
    suite: "rdf-order",
    objects: [{ name: "RDF payment document", form: "application/ld+json", shown: value }],
    native: {
      facts: new PaymentFacts(result.root, result.dataset),
      documentDigest: digestOf(value),
    },
  };
}
export async function paymentTrace(facts: PaymentFacts): Promise<SettlementTrace> {
  const name = facts.types.has(SCHEMA + "Invoice")
    ? "Invoice"
    : facts.types.has(ODRL + "Offer")
      ? "Service offer"
      : facts.kind === "payment-receipt"
        ? "Payment receipt"
        : "Payment order";
  return {
    suite: "rdf-order",
    objects: [{ name, form: "application/ld+json", shown: "Same document as facts." }],
    facts: await paymentDocument(facts),
    sameDocument: "The protocol object and lifted facts are the same RDF document.",
  };
}

import { canonicalJson, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import type { ActionIntent, Agreement } from "../core/types.js";
import { sameAmount } from "../gates/payment.js";
import { actionDigest, mandateSchema, type OwnerMandate } from "../mechanisms/mandate.js";
import { solidOdrlEngine } from "../mechanisms/policy-engine.js";
import { unverifiedEvidenceClaim } from "../mechanisms/selective.js";
import { approvalSchema, TYP } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { PaymentAgreementNode, PaymentOfferNode } from "../model/payment.js";
import { alternativeWireId } from "../profile/configurations.js";
import { AgreementCredentialProtocol, agreementMessageNode } from "./agreement-credential.js";
import { verifyCompact } from "./jws-compact.js";
import { verifyRecordedMessage } from "./recorded-message.js";
/** Independently check both carried message proofs and the acceptance's mandate/approval. */
export async function verifyPaymentProofs(
  facts: PaymentFacts,
  trust: TrustStore,
  now: string,
  credentialProtocol?: AgreementCredentialProtocol,
  requireCredential = false,
): Promise<boolean> {
  const agreement = facts.heldAgreement;
  if (!agreement?.offerProof || !agreement.acceptanceProof) return false;
  const [offered, accepted] = await Promise.all(
    [agreement.offerProof, agreement.acceptanceProof].map((proof) =>
      verifyRecordedMessage(proof, trust),
    ),
  );
  if (
    !offered ||
    !accepted ||
    offered.message.kind !== "propose" ||
    accepted.message.kind !== "accept"
  )
    return false;
  const offer = offered.message,
    acceptance = accepted.message;
  if (
    requireCredential ||
    offer.configuration === alternativeWireId("commitments-agreement-credential")
  ) {
    if (
      !credentialProtocol ||
      (
        await credentialProtocol.check(
          agreementMessageNode(acceptance)!,
          agreementMessageNode(offer),
          trust,
          now,
        )
      ).state !== "agreement"
    )
      return false;
  }
  if (
    offered.pinned.subject !== offer.from.actor ||
    offered.pinned.party !== offer.from.onBehalfOf ||
    accepted.pinned.subject !== acceptance.from.actor ||
    accepted.pinned.party !== acceptance.from.onBehalfOf ||
    offer.from.onBehalfOf !== facts.payee ||
    acceptance.from.onBehalfOf !== facts.payer ||
    offer.to?.actor !== acceptance.from.actor ||
    acceptance.to?.actor !== offer.from.actor ||
    acceptance.body.proposal !== offer.id ||
    acceptance.body.termsDigest !== offer.body.termsDigest ||
    offer.body.termsDigest !== facts.agreement ||
    digestOf(offer.body.terms) !== facts.agreement
  )
    return false;
  const record: Agreement = {
    type: "agreement",
    id: acceptance.body.agreement,
    conversation: offer.conversation,
    operation: offer.body.operation,
    offer: offer.id,
    acceptance: acceptance.id,
    termsDigest: offer.body.termsDigest,
    terms: offer.body.terms,
    offeror: offer.from,
    acceptor: acceptance.from,
    formedAt: acceptance.createdAt,
  };
  let offerNode: PaymentOfferNode;
  try {
    offerNode = await readPaymentOffer(offer.body.terms);
  } catch {
    return false;
  }
  const original = PaymentAgreementNode.fromRecord(record, {
    offer: agreement.offerProof,
    acceptance: agreement.acceptanceProof,
    offerNode,
  });
  if (
    !original ||
    original.digest !== agreement.digest ||
    original.duty?.payee !== agreement.duty?.payee ||
    !sameAmount(original.duty?.constraint?.amount, facts.amount) ||
    original.duty?.constraint?.currency !== facts.currency ||
    original.validUntil !== agreement.validUntil ||
    original.validFrom !== agreement.validFrom ||
    Date.parse(original.validUntil ?? "") <= Date.parse(now) ||
    Date.parse(original.validUntil ?? "") <= Date.parse(acceptance.createdAt) ||
    original.instalment !== facts.instalment
  )
    return false;
  const mandateProof = acceptance.evidence?.find(
    (e) => e.role === "authorisation" && e.format === "jws-compact",
  );
  const intentRecord = acceptance.evidence?.find(
    (e) => e.role === "authorisation" && e.format === "awp-action-intent/0.1",
  );
  if (!mandateProof || !intentRecord) return false;
  const checked = await verifyCompact(mandateProof.value, {
    resolve: trust.resolver("party"),
    typ: TYP.mandate,
    allowedAlgs: ["EdDSA", "ES256"],
    limits: DEFAULT_LIMITS,
  });
  if (checked.outcome !== "valid" || checked.pinned.subject !== facts.payer) return false;
  const parsed = mandateSchema.safeParse(checked.payload);
  if (!parsed.success) return false;
  const mandate = parsed.data as unknown as OwnerMandate;
  if (
    mandate.issuer !== facts.payer ||
    mandate.subject !== acceptance.from.actor ||
    Date.parse(mandate.validUntil) <= Date.parse(acceptance.createdAt) ||
    Date.parse(mandate.validFrom) > Date.parse(acceptance.createdAt)
  )
    return false;
  let intent: ActionIntent;
  try {
    intent = parseBoundedJson(intentRecord.value, DEFAULT_LIMITS) as unknown as ActionIntent;
    if (canonicalJson(intent) !== intentRecord.value) return false;
  } catch {
    return false;
  }
  if (
    intent.action !== "use" ||
    intent.operation !== offer.body.operation.id ||
    intent.target !== offer.body.operation.id ||
    intent.recipient !== facts.payee ||
    intent.conversation !== offer.conversation ||
    intent.purpose !== offer.body.terms.purpose
  )
    return false;
  const input = {
    agent: mandate.subject,
    action: "use",
    target: intent.target,
    purpose: intent.purpose,
    recipient: intent.recipient,
    at: acceptance.createdAt,
  };
  const auto = solidOdrlEngine.evaluate(mandate.autonomous, input),
    approval = solidOdrlEngine.evaluate(mandate.withApproval, input);
  if ([auto.effect, approval.effect].some((e) => e === "prohibited" || e === "indeterminate"))
    return false;
  if (auto.effect === "permit") return true;
  if (approval.effect !== "permit") return false;
  const proof = acceptance.evidence?.find(
    (e) => e.role === "approval" && e.format === "jws-compact",
  );
  if (!proof) return false;
  const result = await verifyCompact(proof.value, {
    resolve: trust.resolver("party"),
    typ: TYP.approval,
    allowedAlgs: ["EdDSA", "ES256"],
    limits: DEFAULT_LIMITS,
  });
  if (result.outcome !== "valid" || result.pinned.subject !== facts.payer) return false;
  const approved = approvalSchema.safeParse(result.payload);
  return (
    approved.success &&
    approved.data.issuer === facts.payer &&
    approved.data.actor === acceptance.from.actor &&
    approved.data.decision === "approve" &&
    approved.data.actionDigest === actionDigest(intent) &&
    approved.data.conversation === offer.conversation &&
    Date.parse(approved.data.validUntil) > Date.parse(acceptance.createdAt)
  );
}

/** Inspector metadata only. This neither verifies a source nor admits an object. */
export function paymentDocumentIn(message: import("../core/types.js").AnyMessage): unknown {
  if (message.kind === "propose" && message.body?.terms?.payment)
    return message.body?.terms?.payment;
  if (message.kind === "invoke" && message.body?.operation?.id === "urn:op:payment")
    return message.body.input;
  for (const evidence of Array.isArray(message.evidence) ? message.evidence : []) {
    if (evidence.role !== "credential") continue;
    try {
      const claim = unverifiedEvidenceClaim(evidence);
      if (["invoice", "payment-receipt"].includes(String(claim.claimType)) && claim.payment)
        return claim.payment;
    } catch {
      /* The ordinary inbound check will refuse malformed evidence. */
    }
  }
  return undefined;
}

/** Produce the RDF offer while the retained negotiator still needs scalar term mirrors. */
export async function withPaymentOffer(
  terms: import("../core/types.js").JsonObject,
  payer?: string,
): Promise<import("../core/types.js").JsonObject> {
  const due = terms.compensation;
  if (
    !due ||
    typeof due !== "object" ||
    Array.isArray(due) ||
    typeof due.amount !== "string" ||
    typeof due.currency !== "string" ||
    typeof due.payee !== "string" ||
    typeof terms.service !== "string" ||
    typeof terms.validFrom !== "string" ||
    typeof terms.validUntil !== "string"
  )
    throw new TypeError("Incomplete service offer");
  const { payment: _ignored, ...source } = terms;
  const offer = PaymentOfferNode.create({
    digest: digestOf(source),
    payer,
    purpose: typeof terms.purpose === "string" ? terms.purpose : undefined,
    service: terms.service,
    payee: due.payee,
    amount: due.amount,
    currency: due.currency,
    validFrom: terms.validFrom,
    validUntil: terms.validUntil,
    instalment: typeof due.instalment === "number" ? due.instalment : 1,
    offerProof: "",
    acceptanceProof: "",
  });
  return {
    ...source,
    payment: (await writeDocument(offer)) as import("../core/types.js").JsonObject,
  };
}
export async function readPaymentOffer(
  terms: import("../core/types.js").JsonObject,
): Promise<PaymentOfferNode> {
  const parsed = await readDocument(JSON.stringify(terms.payment), "application/ld+json");
  if (!parsed.ok) throw new TypeError("The signed RDF offer is invalid");
  const offer = new PaymentOfferNode(parsed.root, parsed.dataset),
    due = terms.compensation;
  if (
    !due ||
    typeof due !== "object" ||
    Array.isArray(due) ||
    !sameAmount(offer.duty?.constraint?.amount, String(due.amount)) ||
    offer.duty?.constraint?.currency !== due.currency ||
    offer.duty?.payee !== due.payee ||
    offer.service !== terms.service ||
    offer.validUntil !== terms.validUntil ||
    offer.validFrom !== terms.validFrom ||
    offer.instalment !== (due.instalment ?? 1)
  )
    throw new TypeError("RDF offer and retained term mirrors differ");
  return offer;
}

/** Pure lifting refuses protocol objects changed after admission. No foreign parser runs here. */
export function liftPaymentObjects(objects: ProtocolObjects): PaymentFacts {
  const native = objects.native as { facts?: PaymentFacts; documentDigest?: string } | undefined;
  if (
    objects.suite !== "rdf-order" ||
    !(native?.facts instanceof PaymentFacts) ||
    objects.objects.length !== 1 ||
    objects.objects[0]?.form !== "application/ld+json" ||
    native.documentDigest !== digestOf(objects.objects[0]?.shown)
  )
    throw new TypeError("RDF payment objects changed or were not admitted");
  return native.facts;
}
