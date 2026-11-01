// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { buildAddressBook, Contact } from "@jeswr/solid-task-model/contacts";
import {
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { AddressBookData, ContactData } from "../lib/model";
import type { ContactsModel } from "../lib/model/book";
import { replacement, type Snapshot } from "../lib/model/transport";

const PREFERENCES = "http://www.w3.org/ns/pim/space#preferencesFile";
const PRIVATE_INDEX = "http://www.w3.org/ns/solid/terms#privateTypeIndex";

/** Only a confirmed 404 permits a conditional create. */
export async function optionalDocument<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return undefined;
    throw error;
  }
}

/** Resume the model's index-first creation without replacing any existing data. */
export async function ensureBook(model: ContactsModel, owner: string): Promise<void> {
  if (await optionalDocument(() => model.loadAddressBook())) return;
  const dataset = buildAddressBook(model.bookUrl, { title: "Contacts", owner });
  for (const path of ["people.ttl", "groups.ttl"]) {
    const url = new URL(path, model.bookUrl).href;
    const existing = await optionalDocument(() => model.transport.read(url, (value) => value));
    if (existing) {
      // An interrupted create leaves empty indexes. A populated orphan needs human recovery;
      // it is not safe to adopt an unrelated RDF document or overwrite it with an empty index.
      if (existing.dataset.size) throw new Error("An existing contacts index is not empty.");
    } else {
      await model.transport.commit([{ url, dataset: new Store(), etag: null }]);
    }
  }
  await model.transport.commit([{ url: model.bookUrl, dataset, etag: null }]);
}

export function pointer(snapshot: Snapshot<unknown>, webId: string, predicate: string) {
  return OptionalFrom.subjectPredicate(
    new TermWrapper(webId, snapshot.dataset, DataFactory),
    predicate,
    NamedNodeAs.string,
  );
}

/** Bootstrap and link a private index through preferences, retaining legacy profile pointers. */
export async function ensurePrivateIndex(model: ContactsModel, webId: string): Promise<string> {
  const read = (url: string) => model.transport.read(url, (dataset) => dataset);
  const profile = await read(webId);
  const preferences = pointer(profile, webId, PREFERENCES);
  const prefsUrl = model.transport.url(preferences ?? "settings/prefs.ttl");
  const prefs = await optionalDocument(() => read(prefsUrl));
  const indexUrl = model.transport.url(
    (prefs && pointer(prefs, webId, PRIVATE_INDEX)) ??
      pointer(profile, webId, PRIVATE_INDEX) ??
      "settings/privateTypeIndex.ttl",
  );
  if (!(await optionalDocument(() => read(indexUrl)))) {
    const dataset = new Store();
    const types = SetFrom.subjectPredicate(
      new TermWrapper(indexUrl, dataset, DataFactory),
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    types.add("http://www.w3.org/ns/solid/terms#TypeIndex");
    types.add("http://www.w3.org/ns/solid/terms#UnlistedDocument");
    await model.transport.commit([{ url: indexUrl, dataset, etag: null }]);
  }
  if (!prefs || pointer(prefs, webId, PRIVATE_INDEX) !== indexUrl) {
    const dataset = new Store(prefs ? [...prefs.dataset] : []);
    OptionalAs.object(
      new TermWrapper(webId, dataset, DataFactory),
      PRIVATE_INDEX,
      indexUrl,
      NamedNodeFrom.string,
    );
    await model.transport.commit([
      prefs ? replacement(prefs, dataset) : { url: prefsUrl, dataset, etag: null },
    ]);
  }
  if (!preferences) {
    const dataset = new Store([...profile.dataset]);
    OptionalAs.object(
      new TermWrapper(webId, dataset, DataFactory),
      PREFERENCES,
      prefsUrl,
      NamedNodeFrom.string,
    );
    await model.transport.commit([replacement(profile, dataset)]);
  }
  return indexUrl;
}

/** Merge recovery links into fresh, ETag-guarded documents; never replace unrelated changes. */
export async function restoreLinks(
  model: ContactsModel,
  book: Snapshot<AddressBookData>,
  person: Snapshot<ContactData>,
  labels: readonly string[],
  people = true,
): Promise<void> {
  const id = `${person.url}#this`;
  if (people) {
    const index = await model.loadPeople(book);
    const dataset = new Store([...index.dataset]);
    const entry = new Contact(id, dataset, DataFactory);
    entry.name = person.data.name;
    entry.inAddressBook = `${book.url}#this`;
    await model.transport.commit([replacement(index, dataset)]);
  }
  const groups = await model.loadGroups(book);
  for (const label of labels) {
    if (!groups.data.some((group) => group.id === label)) continue;
    const group = await model.loadGroup(label);
    await model.setGroupMembers(group, [...new Set([...(group.data.members ?? []), id])]);
  }
}
