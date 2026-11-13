// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// History projection only; no request state or approval recovery setters.
// AUTHORED-BY Claude Fable 5
//
// Typed history accessors for legacy grant metadata and DPV receipts.
// The app only changes revocation metadata; request decisions belong to the SDK.

import { ACCM, DCT, DPV } from "@jeswr/pod-access/requests-solid";
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, TermWrapper } from "@rdfjs/wrapper";
import {
  AliasOptionalAs as OptionalAs,
  AliasOptionalFrom as OptionalFrom,
  AliasSetFrom as SetFrom,
} from "./legacy.js";

/** Legacy history fields; request lifecycle and recovery are owned by the SDK. */
export class GrantHistory extends TermWrapper {
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
  get agent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.agent, NamedNodeAs.string);
  }
  set agent(value: string | undefined) {
    OptionalAs.object(this, ACCM.agent, value, NamedNodeFrom.string);
  }

  /** The snapshotted WAC mode IRIs. */
  get modes(): Set<string> {
    return SetFrom.subjectPredicate(this, ACCM.mode, NamedNodeAs.string, NamedNodeFrom.string);
  }

  get grantRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.grantRef, NamedNodeAs.string);
  }

  get requestRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.requestRef, NamedNodeAs.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.created, LiteralAs.date);
  }

  get revokedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, ACCM.revokedAt, LiteralAs.date);
  }
  set revokedAt(value: Date | undefined) {
    OptionalAs.object(this, ACCM.revokedAt, value, LiteralFrom.dateTime);
  }
}

/** The DPV 2.2 consent-record fields (proposal §2.1 — receipts adopt DPV/27560). */
export class ConsentReceipt extends GrantHistory {
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
