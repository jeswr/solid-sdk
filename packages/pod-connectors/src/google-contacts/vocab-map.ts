// AUTHORED-BY Codex GPT-6.1-Sol
import type { DataFactory as Factory } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { PodThing, safeIri } from "../core/vocab.js";
import { createVocabMap } from "../core/vocab-map.js";
import type { GoogleAddress, GoogleName, GoogleOrganization } from "./fixtures.js";

export const VCARD = "http://www.w3.org/2006/vcard/ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

/** Ignore malformed optional values, retaining the source's literal spelling. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export class AddressBook extends PodThing {
  set title(value: string) {
    OptionalAs.object(this, "http://purl.org/dc/terms/title", value, LiteralFrom.string);
  }
  set nameEmailIndex(value: string) {
    OptionalAs.object(this, `${VCARD}nameEmailIndex`, value, NamedNodeFrom.string);
  }
}

/** The same named subject appears in people.ttl and its own person document. */
export class Contact extends PodThing {
  get fn(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${VCARD}fn`, LiteralAs.string);
  }
  set fn(value: string | undefined) {
    OptionalAs.object(this, `${VCARD}fn`, value, LiteralFrom.string);
  }
  get inAddressBook(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${VCARD}inAddressBook`, NamedNodeAs.string);
  }
  set inAddressBook(value: string | undefined) {
    OptionalAs.object(this, `${VCARD}inAddressBook`, value, NamedNodeFrom.string);
  }
  set hasName(value: string) {
    OptionalAs.object(this, `${VCARD}hasName`, value, NamedNodeFrom.string);
  }
  get emails(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${VCARD}hasEmail`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get telephones(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${VCARD}hasTelephone`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get addresses(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${VCARD}hasAddress`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  addOrganization(value: GoogleOrganization): void {
    for (const [predicate, field] of [
      ["organization-name", value.name],
      ["title", value.title],
      ["role", value.jobDescription],
    ]) {
      const label = text(field);
      if (label)
        SetFrom.subjectPredicate(
          this,
          `${VCARD}${predicate}`,
          LiteralAs.string,
          LiteralFrom.string,
        ).add(label);
    }
  }
  set birthday(value: string) {
    OptionalAs.object(this, `${VCARD}bday`, value, (date: string, factory: Factory) =>
      factory.literal(
        date,
        factory.namedNode(`${XSD}${date.startsWith("--") ? "gMonthDay" : "date"}`),
      ),
    );
  }
}

export class ContactName extends PodThing {
  set parts(value: GoogleName) {
    for (const [predicate, field] of [
      ["given-name", value.givenName],
      ["family-name", value.familyName],
      ["additional-name", value.middleName],
      ["honorific-prefix", value.honorificPrefix],
      ["honorific-suffix", value.honorificSuffix],
    ])
      OptionalAs.object(this, `${VCARD}${predicate}`, text(field), LiteralFrom.string);
  }
}

export class ContactValue extends PodThing {
  set kind(value: string | undefined) {
    this.types.add(`${VCARD}${value === "home" ? "Home" : value === "work" ? "Work" : "Other"}`);
  }
  set iri(value: string) {
    OptionalAs.object(this, `${VCARD}value`, safeIri(value), NamedNodeFrom.string);
  }
  set raw(value: string) {
    OptionalAs.object(this, `${VCARD}value`, value, LiteralFrom.string);
  }
}

export class ContactAddress extends ContactValue {
  set fields(value: GoogleAddress) {
    for (const [predicate, field] of [
      ["street-address", value.streetAddress],
      ["locality", value.city],
      ["region", value.region],
      ["postal-code", value.postalCode],
      ["country-name", value.country],
    ])
      OptionalAs.object(this, `${VCARD}${predicate}`, text(field), LiteralFrom.string);
  }
}

// core/federation-vocab.ts has no contacts constants yet. V10 retains vCard as the write
// model; keep the alignment seam without inventing sector class IRIs.
export const vocabMap = createVocabMap({});
