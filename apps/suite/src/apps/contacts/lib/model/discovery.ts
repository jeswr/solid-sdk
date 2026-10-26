// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import type { ContactsModel } from "./book";
import {
  BOOK_CLASS,
  CONTACT_CLASS,
  ContactsDataset,
  contactData,
  GROUP_CLASS,
  iterateFlatContacts,
} from "./data";
import { replacement } from "./transport";

const SOLID = "http://www.w3.org/ns/solid/terms#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Ported from PM's type-index.ts; no profile bootstrapping or SDK API assumptions. */
export class TypeRegistration extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get classes(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}forClass`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instance`, NamedNodeAs.string);
  }
  set instance(value: string | undefined) {
    OptionalAs.object(this, `${SOLID}instance`, value, NamedNodeFrom.string);
  }
  get container(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set container(value: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, value, NamedNodeFrom.string);
  }
}

export class TypeIndexDataset extends DatasetWrapper {
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }
}

/** Register into an existing, caller-selected index, preserving every other registration. */
export async function registerAddressBook(model: ContactsModel, indexUrl: string): Promise<void> {
  const snapshot = await model.transport.read(indexUrl, (dataset) => dataset);
  const dataset = new Store([...snapshot.dataset]);
  const registrations = [...new TypeIndexDataset(dataset, DataFactory).registrations];
  const locations = [
    { classIri: BOOK_CLASS, instance: `${model.bookUrl}#this`, container: undefined },
    {
      classIri: CONTACT_CLASS,
      instance: undefined,
      container: new URL("people/", model.bookUrl).href,
    },
    {
      classIri: GROUP_CLASS,
      instance: undefined,
      container: new URL("groups/", model.bookUrl).href,
    },
  ];
  for (const [i, location] of locations.entries()) {
    if (
      registrations.some(
        (r) =>
          r.classes.has(location.classIri) &&
          r.instance === location.instance &&
          r.container === location.container,
      )
    )
      continue;
    const entry = new TypeRegistration(
      `${snapshot.url}#contacts-${crypto.randomUUID()}-${i}`,
      dataset,
      DataFactory,
    );
    entry.types.add(`${SOLID}TypeRegistration`);
    entry.classes.add(location.classIri);
    entry.instance = location.instance;
    entry.container = location.container;
  }
  if (dataset.size !== snapshot.dataset.size) {
    await model.transport.commit([replacement(snapshot, dataset)]);
  }
}

/**
 * Bounded discovery from a supplied Type Index: no whole-pod crawl. Reads canonical books
 * and PM flat individuals, including registrations for a flat contacts/ container.
 * Results are hints; the later hooks decide whether to display or migrate the flat contacts.
 */
export async function discoverContacts(
  model: ContactsModel,
  indexUrl: string,
  limit = 200,
  signal = AbortSignal.timeout(10_000),
) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new TypeError("A positive discovery limit is required.");
  signal.throwIfAborted();
  const index = await model.transport.read(
    indexUrl,
    (dataset) => new TypeIndexDataset(dataset, DataFactory),
    signal,
  );
  const sources = new Set<string>();
  const books = new Set<string>();
  const flat = new Map<
    string,
    Awaited<ReturnType<ContactsModel["loadFlatContacts"]>>["data"][number]
  >();
  let remaining = limit;
  let incomplete = false;
  const read = async (url: string) => {
    signal.throwIfAborted();
    const target = model.transport.url(url);
    if (sources.has(target)) return undefined;
    if (remaining === 0) {
      incomplete = true;
      return undefined;
    }
    remaining--;
    sources.add(target);
    try {
      return await model.transport.read(target, (dataset) => dataset, signal);
    } catch (error) {
      // Stale/deleted registrations are expected. Unreadable resources are never writable empties.
      if (error instanceof RdfFetchError && error.status === 404) return undefined;
      throw error;
    }
  };
  const full = () => books.size + flat.size >= limit;
  const collect = async (url: string) => {
    const snapshot = await read(url);
    if (!snapshot) return;
    for (const book of new ContactsDataset(snapshot.dataset, DataFactory).books) {
      signal.throwIfAborted();
      if (books.has(book.id)) continue;
      if (full()) {
        incomplete = true;
        return;
      }
      books.add(book.id);
    }
    for (const contact of iterateFlatContacts(snapshot.dataset)) {
      signal.throwIfAborted();
      if (flat.has(contact.id)) continue;
      if (full()) {
        incomplete = true;
        return;
      }
      flat.set(contact.id, { id: contact.id, data: contactData(contact) });
    }
  };
  for (const registration of index.data.registrations) {
    if (!registration.classes.has(BOOK_CLASS) && !registration.classes.has(CONTACT_CLASS)) continue;
    signal.throwIfAborted();
    if (full()) {
      incomplete = true;
      break;
    }
    if (registration.instance) await collect(registration.instance);
    if (registration.container) {
      if (full()) {
        incomplete = true;
        break;
      }
      const listing = await read(registration.container);
      if (!listing) continue;
      const container = new Container(listing.url, listing.dataset, DataFactory);
      for (const child of container.contains) {
        signal.throwIfAborted();
        if (full() || remaining === 0) {
          incomplete = true;
          break;
        }
        if (!child.value.endsWith("/")) await collect(child.value);
      }
    }
  }
  return { books: [...books], flat: [...flat.values()], incomplete };
}
