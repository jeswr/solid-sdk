// AUTHORED-BY Claude Fable 5
//
// Typed @rdfjs/wrapper accessors for the three record shapes the app writes:
// the access-request lifecycle fields (accm: status + the §3.5 CAS-persisted
// snapshot), the grant record, and the DPV 2.2 consent receipt. These are the
// ONLY write paths — every mutation goes through these wrapper setters (the
// house RDF discipline: typed accessors + n3.Writer, never hand-built triples).

import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { ACCM, DCT, DPV } from "./vocab.js";

/** The request lifecycle status values (proposal §3.5 state machine). */
export type RequestStatus = "Pending" | "Approving" | "Approved" | "Denied";

const STATUS_IRI: Record<RequestStatus, string> = {
  Pending: ACCM.Pending,
  Approving: ACCM.Approving,
  Approved: ACCM.Approved,
  Denied: ACCM.Denied,
};
const IRI_STATUS: Record<string, RequestStatus> = Object.fromEntries(
  Object.entries(STATUS_IRI).map(([k, v]) => [v, k as RequestStatus]),
);

export function statusFromIri(iri: string | undefined): RequestStatus | undefined {
  return iri === undefined ? undefined : IRI_STATUS[iri];
}
export function statusToIri(status: RequestStatus): string {
  return STATUS_IRI[status];
}

/**
 * The accm: lifecycle + snapshot fields carried on a request resource (and
 * mirrored onto grant records / receipts). One wrapper class serves all three
 * documents — they share the vocabulary.
 */
export class AccmRecord extends TermWrapper {
  get statusIri(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.status, NamedNodeAs.string);
  }
  set statusIri(value: string | undefined) {
    OptionalAs.object(this, ACCM.status, value, NamedNodeFrom.string);
  }

  get status(): RequestStatus | undefined {
    return statusFromIri(this.statusIri);
  }
  set status(value: RequestStatus) {
    this.statusIri = statusToIri(value);
  }

  /** The deterministic grant id (hex digest — proposal §3.5). */
  get grantId(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.grantId, LiteralAs.string);
  }
  set grantId(value: string | undefined) {
    OptionalAs.object(this, ACCM.grantId, value, LiteralFrom.string);
  }

  /** The CAS-pinned resolved target set (server/app-derived — §2.2). */
  get resolvesTo(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      ACCM.resolvesTo,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** The snapshotted grantee agent. */
  get snapshotAgent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.agent, NamedNodeAs.string);
  }
  set snapshotAgent(value: string | undefined) {
    OptionalAs.object(this, ACCM.agent, value, NamedNodeFrom.string);
  }

  /** The snapshotted WAC mode IRIs. */
  get snapshotModes(): Set<string> {
    return SetFrom.subjectPredicate(this, ACCM.mode, NamedNodeAs.string, NamedNodeFrom.string);
  }

  get schemaVersion(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.schemaVersion, LiteralAs.string);
  }
  set schemaVersion(value: string | undefined) {
    OptionalAs.object(this, ACCM.schemaVersion, value, LiteralFrom.string);
  }

  get grantRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.grantRef, NamedNodeAs.string);
  }
  set grantRef(value: string | undefined) {
    OptionalAs.object(this, ACCM.grantRef, value, NamedNodeFrom.string);
  }

  get requestRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.requestRef, NamedNodeAs.string);
  }
  set requestRef(value: string | undefined) {
    OptionalAs.object(this, ACCM.requestRef, value, NamedNodeFrom.string);
  }

  get dataClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.dataClass, NamedNodeAs.string);
  }
  set dataClass(value: string | undefined) {
    OptionalAs.object(this, ACCM.dataClass, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.created, LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, DCT.created, value, LiteralFrom.dateTime);
  }

  get revokedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.revokedAt, LiteralAs.date);
  }
  set revokedAt(value: Date | undefined) {
    OptionalAs.object(this, ACCM.revokedAt, value, LiteralFrom.dateTime);
  }
}

/** The DPV 2.2 consent-record fields (proposal §2.1 — receipts adopt DPV/27560). */
export class ConsentReceipt extends AccmRecord {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  get dataSubject(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DPV.hasDataSubject, NamedNodeAs.string);
  }
  set dataSubject(value: string | undefined) {
    OptionalAs.object(this, DPV.hasDataSubject, value, NamedNodeFrom.string);
  }

  get recipient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DPV.hasRecipient, NamedNodeAs.string);
  }
  set recipient(value: string | undefined) {
    OptionalAs.object(this, DPV.hasRecipient, value, NamedNodeFrom.string);
  }

  get purpose(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DPV.hasPurpose, NamedNodeAs.string);
  }
  set purpose(value: string | undefined) {
    OptionalAs.object(this, DPV.hasPurpose, value, NamedNodeFrom.string);
  }

  get consentStatus(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DPV.hasConsentStatus, NamedNodeAs.string);
  }
  set consentStatus(value: string | undefined) {
    OptionalAs.object(this, DPV.hasConsentStatus, value, NamedNodeFrom.string);
  }

  get legalBasis(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DPV.hasLegalBasis, NamedNodeAs.string);
  }
  set legalBasis(value: string | undefined) {
    OptionalAs.object(this, DPV.hasLegalBasis, value, NamedNodeFrom.string);
  }
}
