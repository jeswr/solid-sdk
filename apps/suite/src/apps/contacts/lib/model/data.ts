// AUTHORED-BY Codex GPT-6.1-Sol
import { isHttpIri, safeHttpIri } from "@jeswr/rdf-serialize";
import {
  Contact,
  ContactBook,
  type ContactData,
  ContactGroup,
} from "@jeswr/solid-task-model/contacts";
import type { DatasetCore, Term } from "@rdfjs/types";
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

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
  return [...iterateFlatContacts(dataset)].map((contact) => ({
    id: contact.id,
    data: contactData(contact),
  }));
}

export function* iterateFlatContacts(dataset: DatasetCore) {
  for (const contact of new ContactsDataset(dataset, DataFactory).contacts) {
    if (!contact.inAddressBook) yield contact;
  }
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
  const webId = readWebId(contact);
  if (webId !== undefined) data.webId = webId;
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

/** Match the shared setters' canonical URL requirement without silently dropping identifiers. */
export function contactIdentifier(value: string): string {
  const safe = safeHttpIri(value);
  if (!safe || new URL(safe).href !== value) {
    throw new TypeError("Contact identifiers must be canonical absolute HTTP(S) URLs.");
  }
  return value;
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
  if (data.webId !== undefined) contactIdentifier(data.webId);
  if (data.created !== undefined && !Number.isFinite(data.created.getTime())) {
    throw new TypeError("Invalid creation date.");
  }
}

// AUTHORED-BY Codex GPT-6
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// Parsed RDF and shared packages can use separate N3 instances whose counters overlap.
// Give newly minted nodes unique labels before copying them into the existing dataset.
const contactFactory = {
  ...DataFactory,
  blankNode: (label?: string) => DataFactory.blankNode(label ?? `contacts-${crypto.randomUUID()}`),
};

function isWebIdNode(term: Term, dataset: DatasetCore): boolean {
  return (
    term.termType === "BlankNode" &&
    dataset.match(term, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${VCARD}WebId`))
      .size > 0
  );
}

/** Explicit WebID nodes take precedence over generic URLs, even after clearing their value. */
function readWebId(contact: Contact): string | undefined {
  let explicit = false;
  for (const edge of contact.dataset.match(
    DataFactory.namedNode(contact.id),
    DataFactory.namedNode(`${VCARD}url`),
  )) {
    if (!isWebIdNode(edge.object, contact.dataset)) continue;
    explicit = true;
    const value = contactPointValue(edge.object, contact.dataset, `${VCARD}url`);
    if (isHttpIri(value) && new URL(value).href === value) return value;
  }
  return explicit ? undefined : contact.webId;
}

/** Persist a cleared selection so unrelated HTTP(S) URLs cannot become the WebID on reload. */
function addClearedWebId(contact: Contact): void {
  const term = contactFactory.blankNode();
  SetFrom.subjectPredicate(contact, `${VCARD}url`, TermAs.term, TermFrom.itself).add(term);
  const child = new TermWrapper(term, contact.dataset, DataFactory);
  SetFrom.subjectPredicate(child, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
    `${VCARD}WebId`,
  );
}

/** Match the shared readers, retaining the original nodes for values still present. */
function contactPointValue(term: Term, dataset: DatasetCore, predicate: string) {
  const value =
    term.termType === "BlankNode"
      ? OptionalFrom.subjectPredicate(
          new TermWrapper(term, dataset, DataFactory),
          `${VCARD}value`,
          NamedNodeAs.string,
        )
      : term.termType === "NamedNode"
        ? term.value
        : undefined;
  return predicate === `${VCARD}hasTelephone` ? value?.replace(/[(). -]/g, "") : value;
}

/** Reuse the shared setters for new values; preserve metadata on every retained node. */
function reconcileContactPoints(contact: Contact, desired: Contact): void {
  const subject = DataFactory.namedNode(contact.id);
  const webId = readWebId(contact);
  const explicitWebId = [
    ...contact.dataset.match(subject, DataFactory.namedNode(`${VCARD}url`)),
  ].some((edge) => isWebIdNode(edge.object, contact.dataset));
  for (const field of ["hasEmail", "hasTelephone", "url"]) {
    // The scalar WebID exposes only one URL value, not the whole URL collection.
    if (field === "url" && webId === desired.webId) continue;
    const predicate = `${VCARD}${field}`;
    const node = DataFactory.namedNode(predicate);
    const pending = new Map(
      [...desired.dataset.match(subject, node)].map((edge) => [
        contactPointValue(edge.object, desired.dataset, predicate),
        edge,
      ]),
    );
    const wanted = new Set(pending.keys());
    for (const edge of [...contact.dataset.match(subject, node)]) {
      const value = contactPointValue(edge.object, contact.dataset, predicate);
      if (wanted.has(value)) {
        // Always write the explicit WebID node, including when selecting an existing homepage.
        if (field !== "url") pending.delete(value);
        continue;
      }
      if (
        field === "url" &&
        (explicitWebId
          ? !isWebIdNode(edge.object, contact.dataset)
          : webId === undefined || value !== webId)
      ) {
        continue;
      }
      contact.dataset.delete(edge);
      // A removed value node may still belong to another contact or property.
      if (
        edge.object.termType === "BlankNode" &&
        contact.dataset.match(null, null, edge.object).size === 0
      ) {
        for (const quad of [...contact.dataset.match(edge.object)]) contact.dataset.delete(quad);
      }
    }
    for (const edge of pending.values()) {
      contact.dataset.add(edge);
      for (const quad of desired.dataset.match(edge.object)) contact.dataset.add(quad);
    }
    if (field === "url" && desired.webId === undefined) addClearedWebId(contact);
  }
}

export function applyContact(contact: Contact, data: ContactData): void {
  validateContact(data);
  const desired = new Contact(contact.id, new Store(), contactFactory);
  desired.setEmails(data.emails ?? []);
  desired.setPhones((data.phones ?? []).map((phone) => phone.replace(/[(). -]/g, "")));
  desired.setWebId(safeHttpIri(data.webId));
  reconcileContactPoints(contact, desired);
  contact.name = data.name;
  contact.note = data.note;
  contact.organization = data.organization;
}

/** Refuse deletion of source RDF outside the flat fields that the migration can reproduce. */
export function requireLosslessMigration(
  dataset: DatasetCore,
  id: string,
  data: ContactData,
): void {
  const { namedNode, literal } = DataFactory;
  const fields = new Map<string, Term[]>([
    ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", [namedNode(CONTACT_CLASS)]],
    [`${VCARD}fn`, [literal(data.name)]],
    [`${VCARD}hasEmail`, (data.emails ?? []).map(namedNode)],
    [
      `${VCARD}hasTelephone`,
      (data.phones ?? []).map((phone) => namedNode(phone.replace(/[(). -]/g, ""))),
    ],
    [`${VCARD}url`, data.webId === undefined ? [] : [namedNode(data.webId)]],
    [`${VCARD}note`, data.note === undefined ? [] : [literal(data.note)]],
    [
      `${VCARD}organization-name`,
      data.organization === undefined ? [] : [literal(data.organization)],
    ],
    [
      "http://purl.org/dc/terms/created",
      data.created === undefined
        ? []
        : [
            literal(
              data.created.toISOString(),
              namedNode("http://www.w3.org/2001/XMLSchema#dateTime"),
            ),
          ],
    ],
  ]);
  for (const quad of dataset) {
    if (
      quad.subject.termType !== "NamedNode" ||
      quad.subject.value !== id ||
      quad.graph.termType !== "DefaultGraph" ||
      !fields.get(quad.predicate.value)?.some((term) => term.equals(quad.object))
    ) {
      throw new TypeError("Migration would discard source RDF; keep the source document.");
    }
  }
}
