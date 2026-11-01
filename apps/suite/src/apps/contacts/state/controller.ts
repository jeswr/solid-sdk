// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { AddressBookData, ContactData, ContactGroupData } from "../lib/model";
// The model barrel also exports the server-side DAV importer. Keep the browser graph
// on its client-safe modules so bundlers never pull in Node's HTTP implementation.
import { ContactsModel } from "../lib/model/book";
import { discoverContacts, registerAddressBook } from "../lib/model/discovery";
import { ContactsWriteError, PartialWriteError, type Snapshot } from "../lib/model/transport";
import { applyContactPatch, type ContactPatch, decodeContactRef, encodeContactRef } from "./data";

export interface ContactsData {
  book: Snapshot<AddressBookData> | null;
  people: Snapshot<ContactData>[];
  groups: Snapshot<ContactGroupData>[];
  flat: { id: string; data: ContactData }[];
  incomplete: boolean;
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
  private current: ContactsState = { status: "loading", data: this.baseline, saving: false };
  constructor(
    fetch: typeof globalThis.fetch,
    readonly storage: string,
    readonly webId: string,
    private onError: (message: string) => void,
  ) {
    this.model = new ContactsModel(fetch, storage);
    this.indexUrl = new URL("settings/privateTypeIndex.ttl", storage).href;
    this.bookUrl = this.model.bookUrl;
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
    const index = await pointer(
      profile.data ?? this.webId,
      "http://www.w3.org/ns/solid/terms#privateTypeIndex",
    );
    this.indexUrl = this.model.transport.url(index.data ?? this.indexUrl);
    try {
      // AddressBook registrations precede the potentially large Individual containers. Discovery
      // is bounded independently of the full people index load and reports truncation to the UI.
      const found = await discoverContacts(this.model, this.indexUrl);
      this.bookUrl = found.books[0] ?? this.model.bookUrl;
      return found;
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404)
        return { flat: [], incomplete: false };
      throw error;
    }
  }
  private async read(discovery: boolean): Promise<ContactsData> {
    const found = discovery
      ? await this.discover()
      : { flat: this.baseline.flat, incomplete: this.baseline.incomplete };
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
        // A registration failure may follow a successful create; a retry only registers it.
        if (!this.baseline.book)
          await this.model.createAddressBook({ title: "Contacts", owner: this.webId });
        await registerAddressBook(this.model, this.indexUrl);
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
        await this.model.createContact(this.book(current), data, url);
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
  delete(id: string) {
    return this.mutate({
      apply: (data) => ({
        ...data,
        people: data.people.filter((p) => `${p.url}#this` !== id),
        groups: data.groups.map((g) => ({
          ...g,
          data: { ...g.data, members: (g.data.members ?? []).filter((member) => member !== id) },
        })),
      }),
      write: (data) => this.model.deleteContact(this.book(data), this.person(data, id)),
    });
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
        await this.model.createContact(this.book(data), person.data, person.url);
        for (const label of labels) {
          const group = data.groups.find((g) => `${g.url}#this` === label);
          if (group) await this.model.setGroupMembers(group, [...(group.data.members ?? []), id]);
        }
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
            await this.model.migrateToBook(this.book(data), source.id);
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
