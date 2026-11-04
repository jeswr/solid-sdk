// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { Contact, type ContactData, ContactGroup } from "@jeswr/solid-task-model/contacts";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import type { ContactsModel } from "./book";
import { contactData } from "./data";
import { ContactsWriteError, replacement, type Snapshot } from "./transport";

/** A full RDF document, including unknown properties and blank-node metadata. */
export interface SavedDocument {
  url: string;
  etag: string | null;
  turtle: string;
}
export async function saveDocument(snapshot: Pick<Snapshot<unknown>, "url" | "etag" | "dataset">) {
  return { url: snapshot.url, etag: snapshot.etag, turtle: await serialize([...snapshot.dataset]) };
}
export async function openDocument(saved: SavedDocument): Promise<Snapshot<ContactData>> {
  const dataset = await parseRdf(saved.turtle, "text/turtle", { baseIRI: saved.url });
  return {
    ...saved,
    dataset,
    data: contactData(new Contact(`${saved.url}#this`, dataset, DataFactory)),
  };
}
export async function absentOr<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return undefined;
    throw error;
  }
}

/** A retry may adopt only the intended identity, never overwrite an occupied destination. */
export async function ensurePerson(model: ContactsModel, saved: SavedDocument) {
  const expected = await openDocument(saved);
  const existing = await absentOr(() => model.loadContact(saved.url));
  if (existing) {
    const uid = (person: Snapshot<ContactData>) =>
      new Contact(`${person.url}#this`, person.dataset, DataFactory).uid;
    const expectedUid = uid(expected);
    const matches = expectedUid
      ? uid(existing) === expectedUid
      : isomorphic([...existing.dataset], [...expected.dataset]);
    if (!matches) throw new ContactsWriteError(412, saved.url, existing.etag);
    return existing;
  }
  await model.transport.commit([{ url: saved.url, dataset: expected.dataset, etag: null }]);
  return expected;
}

/**
 * Replace an existing person only from the reviewed revision. A replay adopts an identical
 * document; a concurrent edit or deletion is a conflict, so nothing later in the merge runs.
 */
export async function ensureReplaced(model: ContactsModel, saved: SavedDocument) {
  const expected = await openDocument(saved);
  const existing = await absentOr(() => model.loadContact(saved.url));
  if (!existing) throw new ContactsWriteError(412, saved.url, null);
  if (isomorphic([...existing.dataset], [...expected.dataset])) return;
  await model.transport.commit([replacement({ ...existing, etag: saved.etag }, expected.dataset)]);
}

/** Absence is success even when the DELETE response was lost. Preserve concurrent edits. */
export async function ensureDeleted(model: ContactsModel, saved: SavedDocument) {
  const existing = await absentOr(() => model.transport.read(saved.url, (dataset) => dataset));
  if (!existing) return;
  try {
    await model.transport.commit([replacement({ ...existing, etag: saved.etag })]);
  } catch (error) {
    if (error instanceof ContactsWriteError && error.status === 404) return;
    throw error;
  }
}

/** Merge one link into fresh RDF, and skip effects already present on replay. */
export async function personLink(
  model: ContactsModel,
  bookUrl: string,
  person: Snapshot<ContactData>,
  add: boolean,
) {
  const book = await model.loadAddressBook(bookUrl);
  const index = await model.loadPeople(book);
  const id = `${person.url}#this`;
  const entry = index.data.find((item) => item.id === id);
  if (add ? entry?.name === person.data.name : !entry) return;
  const dataset = new Store([...index.dataset]);
  if (add) {
    const contact = new Contact(id, dataset, DataFactory);
    contact.name = person.data.name;
    contact.inAddressBook = `${bookUrl}#this`;
  } else {
    for (const quad of dataset.match(DataFactory.namedNode(id))) dataset.delete(quad);
  }
  await model.transport.commit([replacement(index, dataset)]);
}

export async function membership(
  model: ContactsModel,
  bookUrl: string,
  url: string,
  id: string,
  add: boolean,
) {
  const book = await model.loadAddressBook(bookUrl);
  const index = await model.loadGroups(book);
  if (!index.data.some((group) => group.id === `${url}#this`)) return;
  const group = await model.loadGroup(url);
  const members = new ContactGroup(`${url}#this`, group.dataset, DataFactory).members;
  if (members.has(id) === add) return;
  await model.setGroupMembers(group, [
    ...[...members].filter((member) => member !== id),
    ...(add ? [id] : []),
  ]);
}
