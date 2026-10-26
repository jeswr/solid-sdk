// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type AddressBookData,
  buildAddressBook,
  buildGroup,
  buildPerson,
  Contact,
  ContactBook,
  type ContactData,
  ContactGroup,
  type ContactGroupData,
  parseAddressBook,
  parseGroup,
} from "@jeswr/solid-task-model/contacts";
import { DataFactory, Store } from "n3";
import {
  applyContact,
  ContactsDataset,
  contactData,
  contactIdentifier,
  documentUrl,
  flatContacts,
  readGroupsIndex,
  readPeopleIndex,
  requireLosslessMigration,
  requireName,
  validateContact,
} from "./data";
import { type Change, ContactsTransport, replacement, type Snapshot } from "./transport";

function requireData<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("The document is not the expected contacts type.");
  return value;
}

function removeSubject(dataset: Store, id: string): void {
  for (const quad of dataset.match(DataFactory.namedNode(id))) dataset.delete(quad);
}

/**
 * Hook-free SolidOS operations. The caller provisions owner-private contacts/, people/ and
 * groups/ containers. Mutations never change access controls or retry stale snapshots.
 */
export class ContactsModel {
  readonly transport: ContactsTransport;
  readonly bookUrl: string;
  constructor(fetchImpl: typeof fetch, podRoot: string) {
    this.transport = new ContactsTransport(podRoot, fetchImpl);
    this.bookUrl = this.transport.url("contacts/book.ttl");
  }

  loadAddressBook(url = this.bookUrl): Promise<Snapshot<AddressBookData>> {
    const doc = this.transport.url(url);
    return this.transport.read(doc, (dataset) => requireData(parseAddressBook(doc, dataset)));
  }

  loadContact(id: string): Promise<Snapshot<ContactData>> {
    const doc = this.transport.url(id);
    return this.transport.read(doc, (dataset) => {
      const contact = new Contact(`${doc}#this`, dataset, DataFactory);
      return requireData(contact.isIndividual ? contactData(contact) : undefined);
    });
  }

  loadGroup(id: string): Promise<Snapshot<ContactGroupData>> {
    const doc = this.transport.url(id);
    return this.transport.read(doc, (dataset) => requireData(parseGroup(doc, dataset)));
  }

  loadPeople(book: Snapshot<AddressBookData>) {
    const url = book.data.nameEmailIndex ?? new URL("people.ttl", book.url).href;
    return this.transport.read(url, (dataset) => readPeopleIndex(`${book.url}#this`, dataset));
  }

  loadGroups(book: Snapshot<AddressBookData>) {
    const url = book.data.groupIndex ?? new URL("groups.ttl", book.url).href;
    return this.transport.read(url, (dataset) => readGroupsIndex(`${book.url}#this`, dataset));
  }

  async createAddressBook(data: AddressBookData): Promise<void> {
    requireName(data.title);
    const dataset = buildAddressBook(this.bookUrl, data);
    const book = new ContactBook(`${this.bookUrl}#this`, dataset, DataFactory);
    // Validate both links before doing any I/O. Existing documents cannot be replaced.
    const peopleUrl = this.transport.url(requireData(book.nameEmailIndex));
    const groupsUrl = this.transport.url(requireData(book.groupIndex));
    if (new Set([this.bookUrl, peopleUrl, groupsUrl]).size !== 3) {
      throw new TypeError("Book and index documents must be distinct.");
    }
    await this.transport.commit([
      { url: peopleUrl, dataset: new Store(), etag: null },
      { url: groupsUrl, dataset: new Store(), etag: null },
      { url: this.bookUrl, dataset, etag: null },
    ]);
  }

  private newDocument(book: Snapshot<AddressBookData>, kind: "people" | "groups"): string {
    return new URL(`${kind}/${crypto.randomUUID()}.ttl`, book.url).href;
  }

  private async planContact(
    book: Snapshot<AddressBookData>,
    data: ContactData,
    url: string,
  ): Promise<{ id: string; changes: Change[] }> {
    validateContact(data);
    const doc = this.transport.url(url);
    const people = await this.loadPeople(book);
    const dataset = buildPerson(doc, { ...data, inAddressBook: `${book.url}#this` });
    applyContact(new Contact(`${doc}#this`, dataset, DataFactory), data);
    const index = new Store([...people.dataset]);
    const entry = new Contact(`${doc}#this`, index, DataFactory);
    entry.name = data.name;
    entry.inAddressBook = `${book.url}#this`;
    return {
      id: `${doc}#this`,
      changes: [{ url: doc, dataset, etag: null }, replacement(people, index)],
    };
  }

  async createContact(
    book: Snapshot<AddressBookData>,
    data: ContactData,
    url = this.newDocument(book, "people"),
  ): Promise<string> {
    const plan = await this.planContact(book, data, url);
    await this.transport.commit(plan.changes);
    return plan.id;
  }

  async updateContact(
    book: Snapshot<AddressBookData>,
    person: Snapshot<ContactData>,
    data: ContactData,
  ): Promise<void> {
    validateContact(data);
    const people = await this.loadPeople(book);
    const dataset = new Store([...person.dataset]);
    applyContact(new Contact(`${person.url}#this`, dataset, DataFactory), data);
    const index = new Store([...people.dataset]);
    const entry = new Contact(`${person.url}#this`, index, DataFactory);
    entry.name = data.name;
    entry.inAddressBook = `${book.url}#this`;
    await this.transport.commit([replacement(person, dataset), replacement(people, index)]);
  }

  async createGroup(
    book: Snapshot<AddressBookData>,
    data: ContactGroupData,
    url = this.newDocument(book, "groups"),
  ): Promise<string> {
    requireName(data.name);
    const doc = this.transport.url(url);
    const groups = await this.loadGroups(book);
    const dataset = buildGroup(doc, { ...data, inAddressBook: `${book.url}#this` });
    this.applyMembers(new ContactGroup(`${doc}#this`, dataset, DataFactory), data.members ?? []);
    const index = new Store([...groups.dataset]);
    new ContactBook(`${book.url}#this`, index, DataFactory).includesGroup.add(`${doc}#this`);
    const entry = new ContactGroup(`${doc}#this`, index, DataFactory).mark();
    entry.name = data.name;
    await this.transport.commit([{ url: doc, dataset, etag: null }, replacement(groups, index)]);
    return `${doc}#this`;
  }

  private applyMembers(group: ContactGroup, members: readonly string[]): void {
    const safe = members.map(contactIdentifier);
    group.setMembers(safe);
  }

  async updateGroup(
    book: Snapshot<AddressBookData>,
    group: Snapshot<ContactGroupData>,
    data: ContactGroupData,
  ): Promise<void> {
    requireName(data.name);
    const groups = await this.loadGroups(book);
    const dataset = new Store([...group.dataset]);
    const subject = new ContactGroup(`${group.url}#this`, dataset, DataFactory);
    subject.name = data.name;
    this.applyMembers(subject, data.members ?? []);
    const index = new Store([...groups.dataset]);
    new ContactGroup(`${group.url}#this`, index, DataFactory).name = data.name;
    await this.transport.commit([replacement(group, dataset), replacement(groups, index)]);
  }

  async setGroupMembers(
    group: Snapshot<ContactGroupData>,
    members: readonly string[],
  ): Promise<void> {
    const dataset = new Store([...group.dataset]);
    this.applyMembers(new ContactGroup(`${group.url}#this`, dataset, DataFactory), members);
    await this.transport.commit([replacement(group, dataset)]);
  }

  async deleteGroup(
    book: Snapshot<AddressBookData>,
    group: Snapshot<ContactGroupData>,
  ): Promise<void> {
    const groups = await this.loadGroups(book);
    const index = new Store([...groups.dataset]);
    new ContactBook(`${book.url}#this`, index, DataFactory).includesGroup.delete(
      `${group.url}#this`,
    );
    removeSubject(index, `${group.url}#this`);
    await this.transport.commit([replacement(groups, index), replacement(group)]);
  }

  async deleteContact(
    book: Snapshot<AddressBookData>,
    person: Snapshot<ContactData>,
  ): Promise<void> {
    const people = await this.loadPeople(book);
    const groups = await this.loadGroups(book);
    const changes: Change[] = [];
    // Remove memberships before deleting the person. Every affected group is ETag guarded.
    for (const entry of groups.data) {
      const group = await this.loadGroup(entry.id);
      const dataset = new Store([...group.dataset]);
      const members = new ContactGroup(`${group.url}#this`, dataset, DataFactory).members;
      if (members.delete(`${person.url}#this`)) changes.push(replacement(group, dataset));
    }
    const index = new Store([...people.dataset]);
    removeSubject(index, `${person.url}#this`);
    changes.push(replacement(people, index), replacement(person));
    await this.transport.commit(changes);
  }

  loadFlatContacts(url: string) {
    return this.transport.read(url, flatContacts);
  }

  /** Explicit migration, never automatic on first read; source is deleted LAST. */
  async migrateToBook(
    book: Snapshot<AddressBookData>,
    sourceUrl: string,
    destination = this.newDocument(book, "people"),
  ): Promise<string> {
    const source = await this.loadFlatContacts(sourceUrl);
    const candidate = source.data[0];
    if (
      source.data.length !== 1 ||
      [...new ContactsDataset(source.dataset, DataFactory).contacts].length !== 1 ||
      !candidate
    ) {
      throw new TypeError("Migration requires one flat contact per source document.");
    }
    if (documentUrl(this.transport.url(destination)) === source.url) {
      throw new TypeError("Migration requires a distinct destination document.");
    }
    requireLosslessMigration(source.dataset, candidate.id, candidate.data);
    // Require a source ETag BEFORE creating anything; preserve the original on every failure.
    const deletion = replacement(source);
    const plan = await this.planContact(book, candidate.data, destination);
    await this.transport.commit([...plan.changes, deletion]);
    return plan.id;
  }
}
