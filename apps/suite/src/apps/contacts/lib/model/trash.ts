// AUTHORED-BY Claude Opus 5.5
/**
 * App-managed Contacts trash (07-parity-backlog "Trash / undo delete", used while the storage
 * reports no trash capability). A trashed contact is one self-describing document in
 * `<book container>/.trash/`: the person's RDF, unchanged and still about its original IRIs,
 * plus a `prov:Entity` record whose subject is the trash document itself. The record uses the
 * same PROV-O / Dublin Core terms as Drive's trash index (`prov:wasDerivedFrom` for the original
 * document, `prov:invalidatedAtTime`, `prov:wasAttributedTo`) and `dct:isPartOf` for each label
 * (`vcard:Group`) the contact belonged to. Accessors go through `@rdfjs/wrapper`.
 */

import { Contact, type ContactData } from "@jeswr/solid-task-model/contacts";
import type { DatasetCore } from "@rdfjs/types";
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
import { DataFactory, Store } from "n3";
import { contactData } from "./data";
import type { Snapshot } from "./transport";

const PROV = "http://www.w3.org/ns/prov#";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ENTITY = `${PROV}Entity`;

/** Trashed contacts are deleted for ever after this many days. */
export const TRASH_RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface TrashData {
  /** The person document the contact lived at, and is restored to. */
  original: string;
  deletedAt: Date;
  deletedBy?: string;
  /** Label (`vcard:Group`) IDs, including `#this`, the contact belonged to. */
  labels: string[];
  contact: ContactData;
}

export class TrashRecord extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get originalDocument(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasDerivedFrom`, NamedNodeAs.string);
  }
  set originalDocument(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasDerivedFrom`, value, NamedNodeFrom.string);
  }
  get deletedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}invalidatedAtTime`, LiteralAs.date);
  }
  set deletedAt(value: Date | undefined) {
    OptionalAs.object(this, `${PROV}invalidatedAtTime`, value, LiteralFrom.dateTime);
  }
  get deletedBy(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasAttributedTo`, NamedNodeAs.string);
  }
  set deletedBy(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasAttributedTo`, value, NamedNodeFrom.string);
  }
  get labels(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${DCT}isPartOf`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** The trash document: the person's full RDF plus the record about this trash document. */
export function trashDocument(
  url: string,
  person: Pick<Snapshot<unknown>, "url" | "dataset">,
  details: { deletedAt: Date; labels: readonly string[]; deletedBy?: string },
): Store {
  const dataset = new Store([...person.dataset]);
  const record = new TrashRecord(url, dataset, DataFactory);
  record.types.add(ENTITY);
  record.originalDocument = person.url;
  record.deletedAt = details.deletedAt;
  record.deletedBy = details.deletedBy;
  for (const label of details.labels) record.labels.add(label);
  return dataset;
}

/** Read a trash document; anything that is not a trashed individual is rejected. */
export function parseTrash(url: string, dataset: DatasetCore): TrashData {
  const record = new TrashRecord(url, dataset, DataFactory);
  const original = record.originalDocument;
  const deletedAt = record.deletedAt;
  if (!record.types.has(ENTITY) || !original || !deletedAt || Number.isNaN(deletedAt.getTime()))
    throw new TypeError("The document is not a trashed contact.");
  const contact = new Contact(`${original}#this`, dataset, DataFactory);
  if (!contact.isIndividual) throw new TypeError("The document is not a trashed contact.");
  const deletedBy = record.deletedBy;
  return {
    original,
    deletedAt,
    ...(deletedBy ? { deletedBy } : {}),
    labels: [...record.labels].sort(),
    contact: contactData(contact),
  };
}

/** The person's RDF exactly as it was trashed: everything except the trash record. */
export function trashedPerson(url: string, dataset: DatasetCore): Store {
  return new Store(
    [...dataset].filter(
      (quad) => !(quad.subject.termType === "NamedNode" && quad.subject.value === url),
    ),
  );
}

export function isExpired(deletedAt: Date, now = Date.now()): boolean {
  return now - deletedAt.getTime() > TRASH_RETENTION_DAYS * DAY;
}

export function trashContainer(bookUrl: string): string {
  return new URL(".trash/", bookUrl).href;
}
