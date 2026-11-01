// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { AddressBookData, ContactData, ContactGroupData } from "../lib/model";
// The model barrel also exports the server-side DAV importer. Keep the browser graph
// on its client-safe modules so bundlers never pull in Node's HTTP implementation.
import { ContactsModel } from "../lib/model/book";
import { discoverContacts } from "../lib/model/discovery";
import { openDocument, saveDocument } from "../lib/model/intent";
import {
  ContactsWriteError,
  PartialWriteError,
  replacement,
  type Snapshot,
} from "../lib/model/transport";
import { applyContactPatch, type ContactPatch, decodeContactRef, encodeContactRef } from "./data";
import { type DeleteToken, IntentConflictError, IntentRunner, newIntent } from "./intents";
import { browserIntentStorage, type Intent, IntentJournal, type IntentStorage } from "./journal";
import { applyMerge, type MergeSelection, mergeContactData, mergedDocument } from "./merge";
import { optionalDocument } from "./recovery";

export interface ContactsData {
  book: Snapshot<AddressBookData> | null;
  people: Snapshot<ContactData>[];
  groups: Snapshot<ContactGroupData>[];
  flat: { id: string; data: ContactData }[];
  incomplete: boolean;
  registrationPending: boolean;
}
export interface ContactsState {
  status: "loading" | "ready" | "error";
  data: ContactsData;
  error?: unknown;
  saving: boolean;
}
const empty = (): ContactsData => ({
  book: null,
  people: [],
  groups: [],
  flat: [],
  incomplete: false,
  registrationPending: false,
});

/** Six workers, preserving input order. Rejections stop the load rather than hiding contacts. */
export async function mapContacts<T, R>(
  items: readonly T[],
  read: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        result[index] = await read(items[index] as T);
      }
    }),
  );
  return result;
}

export function writeMessage(error: unknown): string {
  if (error instanceof IntentConflictError) return error.message;
  if (error instanceof PartialWriteError) return writeMessage(error.cause);
  return error instanceof ContactsWriteError && error.status === 412
    ? "This contact changed elsewhere. The latest version has been loaded; try again."
    : "Could not save your contacts. Reloaded the latest version; please try again.";
}

interface Mutation {
  apply(data: ContactsData): ContactsData;
  write(data: ContactsData): Promise<void>;
}
/** Shared index writes are serial. Visible state is the confirmed baseline plus queued intentions. */
export class ContactsController {
  readonly model: ContactsModel;
  private baseline = empty();
  private pending: Mutation[] = [];
  private listeners = new Set<() => void>();
  private generation = 0;
  private refreshQueued = false;
  private tail: Promise<unknown> = Promise.resolve();
  private indexUrl: string;
  private bookUrl: string;
  private registrationPending = false;
  private runner: IntentRunner;
  private journals = new Map<string, IntentJournal>();
  private current: ContactsState = { status: "loading", data: this.baseline, saving: false };
  constructor(
    fetch: typeof globalThis.fetch,
    readonly storage: string,
    readonly webId: string,
    private onError: (message: string) => void,
    private intentStorage: () => IntentStorage = browserIntentStorage,
    onDeleted: (token: DeleteToken) => void = () => {},
  ) {
    this.model = new ContactsModel(fetch, storage);
    this.indexUrl = new URL("settings/privateTypeIndex.ttl", storage).href;
    this.bookUrl = this.model.bookUrl;
    this.runner = new IntentRunner(this.model, webId, onDeleted);
  }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: ContactsState["status"] = "ready", error?: unknown) {
    this.current = {
      status,
      data: this.pending.reduce((data, mutation) => mutation.apply(data), this.baseline),
      saving: this.pending.length > 0,
      ...(error === undefined ? {} : { error }),
    };
    for (const listener of this.listeners) listener();
  }
  private async discover() {
    const pointer = async (url: string, predicate: string) =>
      this.model.transport.read(url, (dataset) =>
        OptionalFrom.subjectPredicate(
          new TermWrapper(this.webId, dataset, DataFactory),
          predicate,
          NamedNodeAs.string,
        ),
      );
    const profile = await pointer(this.webId, "http://www.w3.org/ns/pim/space#preferencesFile");
    const index = await optionalDocument(() =>
      pointer(profile.data ?? this.webId, "http://www.w3.org/ns/solid/terms#privateTypeIndex"),
    );
    this.indexUrl = this.model.transport.url(index?.data ?? this.indexUrl);
    try {
      // AddressBook registrations precede the potentially large Individual containers. Discovery
      // is bounded independently of the full people index load and reports truncation to the UI.
      const found = await discoverContacts(this.model, this.indexUrl);
      this.bookUrl = this.model.transport.url(found.books[0] ?? this.model.bookUrl);
      this.registrationPending = !found.books.length;
      return found;
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) {
        this.registrationPending = true;
        return { flat: [], incomplete: false };
      }
      throw error;
    }
  }
  private journal(bookUrl: string) {
    let journal = this.journals.get(bookUrl);
    if (!journal) {
      journal = new IntentJournal(this.webId, bookUrl, this.onError, this.intentStorage);
      this.journals.set(bookUrl, journal);
    }
    return journal;
  }
  private async resume() {
    let recovered = false;
    for (const bookUrl of new Set([this.model.bookUrl, this.bookUrl])) {
      const journal = this.journal(bookUrl);
      await journal.lock(async () => {
        for (const intent of journal.list()) {
          recovered = true;
          try {
            await this.runner.run(journal, intent);
          } catch (error) {
            if (!(error instanceof IntentConflictError)) throw error;
            this.onError(writeMessage(error));
          }
        }
      });
    }
    return recovered;
  }
  private async perform(
    bookUrl: string,
    matches: (intent: Intent) => boolean,
    prepare: () => Promise<Intent>,
  ) {
    const journal = this.journal(bookUrl);
    return journal.lock(async () => {
      const intent = journal.list().find(matches) ?? (await prepare());
      journal.put(intent); // Must precede the first pod write.
      await this.runner.run(journal, intent);
      return intent;
    });
  }
  private async read(discovery: boolean): Promise<ContactsData> {
    // Recover the conventional/previous book before discovery can observe half a migration.
    const recovered = await this.resume();
    let found =
      discovery || recovered
        ? await this.discover()
        : { flat: this.baseline.flat, incomplete: this.baseline.incomplete };
    // No ready list can hide a partially written document, even in a fresh tab/controller.
    if (await this.resume()) found = await this.discover();
    let book: Snapshot<AddressBookData>;
    try {
      book = await this.model.loadAddressBook(this.bookUrl);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return { ...empty(), ...found };
      throw error;
    }
    const [people, groups] = await Promise.all([
      this.model.loadPeople(book),
      this.model.loadGroups(book),
    ]);
    // Validate book-relative references before fetching documents from an index.
    const safe = (id: string) => decodeContactRef(book.url, encodeContactRef(book.url, id));
    return {
      book,
      ...found,
      registrationPending: this.registrationPending,
      people: await mapContacts(people.data, (entry) => this.model.loadContact(safe(entry.id))),
      groups: await mapContacts(groups.data, (entry) => this.model.loadGroup(safe(entry.id))),
    };
  }
  async refresh(discovery = true) {
    if (this.pending.length) {
      this.refreshQueued ||= discovery;
      return;
    }
    const generation = ++this.generation;
    try {
      const data = await this.read(discovery);
      if (generation !== this.generation) return;
      this.baseline = data;
      this.publish();
    } catch (error) {
      if (generation !== this.generation) return;
      this.baseline = empty();
      this.publish("error", error);
    }
  }
  private mutate(mutation: Mutation): Promise<void> {
    ++this.generation;
    this.pending.push(mutation);
    this.publish();
    const work = this.tail.then(async () => {
      let failure: unknown;
      try {
        await mutation.write(this.baseline);
      } catch (error) {
        failure = error;
        this.onError(writeMessage(error));
      }
      // Partial multi-document writes must reconcile even after failure.
      try {
        this.baseline = await this.read(false);
      } catch (error) {
        this.baseline = empty();
        this.pending = this.pending.filter((item) => item !== mutation);
        this.publish("error", error);
        throw error;
      }
      this.pending = this.pending.filter((item) => item !== mutation);
      this.publish();
      if (!this.pending.length && this.refreshQueued) {
        this.refreshQueued = false;
        await this.refresh();
      }
      if (failure) throw failure;
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
  private book(data: ContactsData) {
    if (!data.book) throw new Error("Create an address book first.");
    return data.book;
  }
  private person(data: ContactsData, id: string) {
    const person = data.people.find((p) => `${p.url}#this` === id);
    if (!person) throw new Error("Contact no longer exists.");
    return person;
  }
  private group(data: ContactsData, id: string) {
    const group = data.groups.find((p) => `${p.url}#this` === id);
    if (!group) throw new Error("Label no longer exists.");
    return group;
  }
  async createBook() {
    await this.mutate({
      apply: (data) => data,
      write: async () => {
        this.registrationPending = true;
        await this.perform(
          this.bookUrl,
          (intent) => intent.kind === "book",
          async () =>
            newIntent("book", this.bookUrl, this.indexUrl, {
              destinations: [
                this.bookUrl,
                this.indexUrl,
                this.baseline.book?.data.nameEmailIndex ?? new URL("people.ttl", this.bookUrl).href,
                this.baseline.book?.data.groupIndex ?? new URL("groups.ttl", this.bookUrl).href,
              ],
            }),
        );
        this.registrationPending = false;
      },
    });
  }
  create(
    data: ContactData,
    url = new URL(`people/${crypto.randomUUID()}.ttl`, this.bookUrl).href,
  ): Promise<string> {
    const person = { url, etag: null, dataset: new Store(), data };
    return this.mutate({
      apply: (current) => ({ ...current, people: [...current.people, person] }),
      write: async (current) => {
        const book = this.book(current);
        await this.perform(
          book.url,
          (intent) => intent.kind === "create" && intent.destination === url,
          async () => {
            const plan = await this.model.planContact(book, data, url);
            return newIntent("create", book.url, url, {
              person: await saveDocument(plan.document),
              destinations: plan.changes.map((change) => change.url),
            });
          },
        );
      },
    }).then(() => `${url}#this`);
  }
  update(id: string, patch: ContactPatch) {
    return this.mutate({
      apply: (data) => ({
        ...data,
        people: data.people.map((p) =>
          `${p.url}#this` === id ? { ...p, data: applyContactPatch(p.data, patch) } : p,
        ),
      }),
      write: async (data) => {
        const person = this.person(data, id);
        await this.model.updateContact(
          this.book(data),
          person,
          applyContactPatch(person.data, patch),
        );
      },
    });
  }
  delete(id: string): Promise<DeleteToken> {
    let token: DeleteToken;
    return this.mutate({
      apply: (data) => ({
        ...data,
        people: data.people.filter((p) => `${p.url}#this` !== id),
        groups: data.groups.map((g) => ({
          ...g,
          data: { ...g.data, members: (g.data.members ?? []).filter((member) => member !== id) },
        })),
      }),
      write: async (data) => {
        const book = this.book(data);
        this.person(data, id);
        const intent = await this.perform(
          book.url,
          (entry) => entry.kind === "delete" && `${entry.destination}#this` === id,
          async () => {
            // This runs after all previously queued updates and reads the actual RDF to delete.
            const person = await this.model.loadContact(id);
            const changes = await this.model.planDeleteContact(book, person);
            const labels = changes.slice(0, -2).map((change) => change.url);
            return newIntent("delete", book.url, person.url, {
              person: await saveDocument(person),
              labels,
              destinations: changes.map((change) => change.url),
            });
          },
        );
        token = { person: intent.person as DeleteToken["person"], labels: intent.labels };
      },
    }).then(() => token);
  }
  async undo(token: DeleteToken) {
    return this.restore(
      await openDocument(token.person),
      token.labels.map((url) => `${url}#this`),
    );
  }

  /** Preserve the document identity and memberships; If-None-Match protects an occupied URL. */
  restore(person: Snapshot<ContactData>, labels: readonly string[]) {
    const id = `${person.url}#this`;
    return this.mutate({
      apply: (data) => ({
        ...data,
        people: [...data.people, person],
        groups: data.groups.map((g) =>
          labels.includes(`${g.url}#this`)
            ? { ...g, data: { ...g.data, members: [...(g.data.members ?? []), id] } }
            : g,
        ),
      }),
      write: async (data) => {
        const book = this.book(data);
        await this.perform(
          book.url,
          (intent) => intent.kind === "restore" && intent.destination === person.url,
          async () => {
            // The initial Undo still requires an unoccupied document. Replays check the saved UID.
            await this.model.transport
              .read(person.url, () => {
                throw new ContactsWriteError(412, person.url, null);
              })
              .catch((error: unknown) => {
                if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
              });
            return newIntent("restore", book.url, person.url, {
              person: await saveDocument(person),
              labels: labels.map((label) => label.replace(/#this$/, "")),
            });
          },
        );
      },
    });
  }
  /**
   * Merge duplicates into the primary as one journaled intent: the merged primary is written
   * first (from its reviewed revision), then label memberships, then each duplicate is removed.
   * Contact points and labels are unioned from fresh RDF when the queued write starts.
   */
  merge(primary: string, duplicates: readonly string[], selection: MergeSelection) {
    const others = [...new Set(duplicates)].filter((other) => other !== primary);
    return this.mutate({
      apply: (data) => applyMerge(data, primary, others, selection),
      write: async (data) => {
        const book = this.book(data);
        if (!others.length) throw new Error("Choose at least two contacts to merge.");
        for (const id of [primary, ...others]) this.person(data, id);
        await this.perform(
          book.url,
          (intent) => intent.kind === "merge" && `${intent.destination}#this` === primary,
          async () => {
            const person = await this.model.loadContact(primary);
            const copies = await mapContacts(others, (id) => this.model.loadContact(id));
            // Every document must be conditionally writable before anything is journaled.
            for (const snapshot of [person, ...copies]) replacement(snapshot);
            const merged = mergeContactData(
              person.data,
              copies.map((copy) => copy.data),
              selection,
            );
            const index = await this.model.loadGroups(book);
            const groups = await mapContacts(index.data, (entry) => this.model.loadGroup(entry.id));
            const labelsOf = (id: string) =>
              groups.filter((group) => group.data.members?.includes(id)).map((group) => group.url);
            const own = labelsOf(primary);
            return newIntent("merge", book.url, person.url, {
              person: await saveDocument({ ...person, dataset: mergedDocument(person, merged) }),
              labels: [...new Set(others.flatMap(labelsOf))].filter((url) => !own.includes(url)),
              duplicates: await Promise.all(
                copies.map(async (copy) => ({
                  person: await saveDocument(copy),
                  labels: labelsOf(`${copy.url}#this`),
                })),
              ),
              destinations: [person.url, ...copies.map((copy) => copy.url)],
            });
          },
        );
      },
    });
  }
  setLabel(id: string, label: string, add: boolean) {
    const change = (group: Snapshot<ContactGroupData>) => ({
      ...group,
      data: {
        ...group.data,
        members: [
          ...new Set([
            ...(group.data.members ?? []).filter((member) => member !== id),
            ...(add ? [id] : []),
          ]),
        ],
      },
    });
    return this.mutate({
      apply: (data) => ({
        ...data,
        groups: data.groups.map((g) => (`${g.url}#this` === label ? change(g) : g)),
      }),
      write: (data) => {
        this.person(data, id);
        const group = this.group(data, label);
        return this.model.setGroupMembers(group, change(group).data.members);
      },
    });
  }
  createLabel(name: string) {
    const group = {
      url: new URL(`groups/${crypto.randomUUID()}.ttl`, this.bookUrl).href,
      etag: null,
      dataset: new Store(),
      data: { name, members: [] },
    };
    return this.mutate({
      apply: (data) => ({ ...data, groups: [...data.groups, group] }),
      write: async (data) => {
        await this.model.createGroup(this.book(data), group.data, group.url);
      },
    });
  }
  renameLabel(id: string, name: string) {
    return this.mutate({
      apply: (data) => ({
        ...data,
        groups: data.groups.map((g) =>
          `${g.url}#this` === id ? { ...g, data: { ...g.data, name } } : g,
        ),
      }),
      write: (data) => {
        const group = this.group(data, id);
        return this.model.updateGroup(this.book(data), group, { ...group.data, name });
      },
    });
  }
  deleteLabel(id: string) {
    return this.mutate({
      apply: (data) => ({ ...data, groups: data.groups.filter((g) => `${g.url}#this` !== id) }),
      write: (data) => this.model.deleteGroup(this.book(data), this.group(data, id)),
    });
  }
  async migrate(): Promise<{ moved: number; failed: number }> {
    let moved = 0;
    let failed = 0;
    // One source at a time: successful entries disappear, failures remain available for retry.
    for (const source of this.current.data.flat) {
      try {
        await this.mutate({
          apply: (data) => data,
          write: async (data) => {
            const book = this.book(data);
            await this.perform(
              book.url,
              (intent) =>
                intent.kind === "migrate" &&
                intent.source?.url === this.model.transport.url(source.id),
              async () => {
                const destination = new URL(`people/${crypto.randomUUID()}.ttl`, book.url).href;
                const { plan, source: original } = await this.model.planMigration(
                  book,
                  source.id,
                  destination,
                );
                return newIntent("migrate", book.url, destination, {
                  person: await saveDocument(plan.document),
                  destinations: plan.changes.map((change) => change.url),
                  source: await saveDocument(original),
                });
              },
            );
            this.baseline = {
              ...this.baseline,
              flat: this.baseline.flat.filter((item) => item.id !== source.id),
            };
          },
        });
        moved++;
      } catch {
        failed++;
      }
    }
    await this.refresh();
    return { moved, failed };
  }
}
