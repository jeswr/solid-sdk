// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import {
  Contact,
  ContactBook,
  type ContactData,
  ContactGroup,
} from "@jeswr/solid-task-model/contacts";
import type { DatasetCore } from "@rdfjs/types";
import { DatasetWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";

export const VCARD = "http://www.w3.org/2006/vcard/ns#";
export const CONTACT_CLASS = `${VCARD}Individual`;
export const BOOK_CLASS = `${VCARD}AddressBook`;
export const GROUP_CLASS = `${VCARD}Group`;

export interface IndexEntry {
  id: string;
  name: string;
}

/** The shared wrappers are also used for PM's #it subjects (direct email/phone IRIs). */
export class ContactsDataset extends DatasetWrapper {
  get contacts(): Iterable<Contact> {
    return this.instancesOf(CONTACT_CLASS, Contact);
  }
  get books(): Iterable<ContactBook> {
    return this.instancesOf(BOOK_CLASS, ContactBook);
  }
}

/** Read only contacts belonging to this book; the index does not require rdf:type. */
export function readPeopleIndex(book: string, dataset: DatasetCore): IndexEntry[] {
  const entries = new Map<string, IndexEntry>();
  for (const quad of dataset.match(
    null,
    DataFactory.namedNode(`${VCARD}inAddressBook`),
    DataFactory.namedNode(book),
  )) {
    if (quad.subject.termType !== "NamedNode") continue;
    const person = new Contact(quad.subject, dataset, DataFactory);
    entries.set(person.id, { id: person.id, name: person.name ?? "" });
  }
  return [...entries.values()];
}

export function readGroupsIndex(book: string, dataset: DatasetCore): IndexEntry[] {
  return [...new ContactBook(book, dataset, DataFactory).includesGroup].map((id) => ({
    id,
    name: new ContactGroup(id, dataset, DataFactory).name ?? "",
  }));
}

/** PM flat contacts are read-only candidates until the caller explicitly migrates them. */
export function flatContacts(dataset: DatasetCore): { id: string; data: ContactData }[] {
  return [...new ContactsDataset(dataset, DataFactory).contacts]
    .filter((contact) => !contact.inAddressBook)
    .map((contact) => ({ id: contact.id, data: contactData(contact) }));
}

/** Keep all migration fields, including multiple direct or structured contact points and ORG. */
export function contactData(contact: Contact): ContactData {
  const data: ContactData = { name: contact.name ?? "" };
  const emails = contact.emails;
  const phones = contact.phones;
  if (emails.length) data.emails = emails;
  if (phones.length) data.phones = phones;
  if (contact.note !== undefined) data.note = contact.note;
  if (contact.organization !== undefined) data.organization = contact.organization;
  if (contact.webId !== undefined) data.webId = contact.webId;
  if (contact.created !== undefined) data.created = contact.created;
  if (contact.inAddressBook !== undefined) data.inAddressBook = contact.inAddressBook;
  return data;
}

export function documentUrl(id: string): string {
  const url = new URL(id);
  url.hash = "";
  return url.href;
}

/** Stable ordering within letters, with an id tie-breaker; never mutate caller arrays. */
export function sortedSections(entries: readonly IndexEntry[], locale = "en") {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const sorted = [...entries].sort(
    (a, b) => collator.compare(a.name.trim(), b.name.trim()) || a.id.localeCompare(b.id),
  );
  const sections = new Map<string, IndexEntry[]>();
  for (const entry of sorted) {
    const first = entry.name.trim().charAt(0).toLocaleUpperCase(locale);
    const letter = /\p{L}/u.test(first) ? first : "#";
    const section = sections.get(letter) ?? [];
    section.push(entry);
    sections.set(letter, section);
  }
  return [...sections].map(([letter, contacts]) => ({ letter, contacts }));
}

export function requireName(name: string): void {
  if (!name.trim()) throw new TypeError("A name is required.");
}

/** Validate before writing rather than letting a serializer silently drop user fields. */
export function validateContact(data: ContactData): void {
  requireName(data.name);
  for (const email of data.emails ?? []) {
    if (!/^(?:mailto:)?[^\s@<>]+@[^\s@<>]+$/.test(email)) {
      throw new TypeError("Invalid email.");
    }
  }
  for (const phone of data.phones ?? []) {
    if (!/^(?:tel:)?\+?\d[\d(). -]*$/.test(phone)) throw new TypeError("Invalid phone.");
  }
  if (data.webId !== undefined && !safeHttpIri(data.webId)) {
    throw new TypeError("Account ID must be an absolute HTTP(S) URL.");
  }
  if (data.created !== undefined && !Number.isFinite(data.created.getTime())) {
    throw new TypeError("Invalid creation date.");
  }
}

export function applyContact(contact: Contact, data: ContactData): void {
  validateContact(data);
  contact.name = data.name;
  contact.setEmails(data.emails ?? []);
  contact.setPhones((data.phones ?? []).map((phone) => phone.replace(/[(). -]/g, "")));
  contact.note = data.note;
  contact.organization = data.organization;
  contact.setWebId(safeHttpIri(data.webId));
}
