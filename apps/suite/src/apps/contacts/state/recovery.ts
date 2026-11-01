// AUTHORED-BY Codex GPT-6.1-Sol
import { buildAddressBook } from "@jeswr/solid-task-model/contacts";
import {
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { ContactsModel } from "../lib/model/book";
import { absentOr as optionalDocument } from "../lib/model/intent";
import { replacement, type Snapshot } from "../lib/model/transport";

export { absentOr as optionalDocument } from "../lib/model/intent";

const PREFERENCES = "http://www.w3.org/ns/pim/space#preferencesFile";
const PRIVATE_INDEX = "http://www.w3.org/ns/solid/terms#privateTypeIndex";

/** Resume the model's index-first creation without replacing any existing data. */
export async function ensureBook(
  model: ContactsModel,
  owner: string,
  confirmed?: (url: string) => void,
): Promise<void> {
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
      await model.transport.commit([{ url, dataset: new Store(), etag: null }], confirmed);
    }
  }
  await model.transport.commit([{ url: model.bookUrl, dataset, etag: null }], confirmed);
}

export function pointer(snapshot: Snapshot<unknown>, webId: string, predicate: string) {
  return OptionalFrom.subjectPredicate(
    new TermWrapper(webId, snapshot.dataset, DataFactory),
    predicate,
    NamedNodeAs.string,
  );
}

/** Bootstrap and link a private index through preferences, retaining legacy profile pointers. */
export async function ensurePrivateIndex(
  model: ContactsModel,
  webId: string,
  confirmed?: (url: string) => void,
): Promise<string> {
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
    await model.transport.commit([{ url: indexUrl, dataset, etag: null }], confirmed);
  }
  if (!prefs || pointer(prefs, webId, PRIVATE_INDEX) !== indexUrl) {
    const dataset = new Store(prefs ? [...prefs.dataset] : []);
    OptionalAs.object(
      new TermWrapper(webId, dataset, DataFactory),
      PRIVATE_INDEX,
      indexUrl,
      NamedNodeFrom.string,
    );
    await model.transport.commit(
      [prefs ? replacement(prefs, dataset) : { url: prefsUrl, dataset, etag: null }],
      confirmed,
    );
  }
  if (!preferences) {
    const dataset = new Store([...profile.dataset]);
    OptionalAs.object(
      new TermWrapper(webId, dataset, DataFactory),
      PREFERENCES,
      prefsUrl,
      NamedNodeFrom.string,
    );
    await model.transport.commit([replacement(profile, dataset)], confirmed);
  }
  return indexUrl;
}
