// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { normalizePodBase, refuseRedirects } from "@jeswr/guarded-fetch";
import { Container, ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { uploadPodImage } from "../../../docs/lib/editor/image-upload";
import { documentSubject, type Revision } from "../../../docs/lib/model/document";
import {
  ConcurrencyValidatorError,
  OutOfScopeError,
  ResourceDeleteError,
  ResourceWriteError,
} from "../../../docs/lib/model/errors";
import { isDirectChild, toSlug } from "../../../docs/lib/model/layout";
import { deleteRdf, readRdf, writeRdf } from "../../../docs/lib/model/rdf-io";
import {
  discoverProfileLinks,
  discoverRegistrations,
  ensureTypeRegistrations,
} from "../../../docs/lib/model/type-index";
import { DOCUMENT_CLASS, NS, PREFIXES } from "../../../docs/lib/model/vocab";
import { notesMediaContainer } from "../images";
import { deleteLabel, mergeLabels } from "../organise/labels";
import { type NoteAction, reduceNoteState } from "../state";
import { NoteConflictError, NoteMoveUncertainError } from "./errors";
import {
  type BuildNoteInput,
  buildNote,
  type Note,
  NoteDoc,
  type NoteLocation,
  parseNote,
} from "./note";

export interface StoredNote extends Note {
  etag: string | null;
}
export interface NoteChanges {
  title?: string;
  body?: string;
  labels?: readonly string[];
}
export interface NoteFailure {
  url: string;
  error: unknown;
}
export interface NotesStoreOptions {
  fetch: typeof fetch;
  podRoot: string;
  webId: string;
  now?: () => Date;
}

/** Account-scoped I/O; every caller and listing URL is checked before it is used. */
export class NotesStore {
  readonly containers: Readonly<Record<NoteLocation, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly podRoot: string;
  private readonly webId: string;
  private initialization?: Promise<void>;

  constructor(options: NotesStoreOptions) {
    this.podRoot = normalizePodBase(options.podRoot);
    this.webId = options.webId;
    this.fetchImpl = refuseRedirects(options.fetch);
    this.now = options.now ?? (() => new Date());
    const active = new URL("notes/", this.podRoot).href;
    this.containers = Object.freeze({
      active,
      archived: `${active}archive/`,
      trashed: `${active}.trash/`,
    });
  }

  async uploadImage(file: Blob): Promise<string> {
    await this.ensureContainers();
    return uploadPodImage(file, notesMediaContainer(this.podRoot), this.fetchImpl);
  }

  private scope(url: string, location?: NoteLocation): NoteLocation {
    const locations =
      location === undefined ? (Object.keys(this.containers) as NoteLocation[]) : [location];
    for (const candidate of locations)
      if (isDirectChild(url, this.containers[candidate])) return candidate;
    throw new OutOfScopeError(url, this.containers[location ?? "active"]);
  }

  async read(url: string): Promise<StoredNote | undefined> {
    const location = this.scope(url);
    const { dataset, etag } = await readRdf(url, this.fetchImpl);
    const note = parseNote(url, dataset, location);
    return note && { ...note, etag };
  }

  async list(location: NoteLocation): Promise<StoredNote[]> {
    let listing: ContainerDataset;
    try {
      const { dataset } = await readRdf(this.containers[location], this.fetchImpl);
      listing = new ContainerDataset(dataset, DataFactory);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return [];
      throw error;
    }
    const children = [...(listing.container?.contains ?? [])].filter(
      (resource) => isDirectChild(resource.id, this.containers[location]) && !resource.isContainer,
    );
    const notes: StoredNote[] = [];
    for (let index = 0; index < children.length; index += 4) {
      const batch = await Promise.all(
        children.slice(index, index + 4).map(async (child) => {
          try {
            return await this.read(child.id);
          } catch {
            return undefined;
          }
        }),
      );
      for (const note of batch) if (note) notes.push(note);
    }
    return notes;
  }

  private async register(): Promise<void> {
    const { dataset: profile } = await readRdf(this.webId, this.fetchImpl);
    const existing = await discoverRegistrations(
      this.webId,
      profile,
      this.fetchImpl,
      this.podRoot,
      true,
    );
    if (
      existing.some(
        (registration) =>
          registration.forClass === DOCUMENT_CLASS &&
          registration.container === this.containers.active,
      )
    )
      return;
    const { privateIndexes } = await discoverProfileLinks(
      this.webId,
      profile,
      this.fetchImpl,
      this.podRoot,
      true,
    );
    // Notes does not create a missing index or modify the profile/preferences.
    if (!privateIndexes.length) return;
    await ensureTypeRegistrations({
      webId: this.webId,
      podRoot: this.podRoot,
      fetchImpl: this.fetchImpl,
      registrations: [{ forClass: DOCUMENT_CLASS, container: this.containers.active }],
    });
  }

  private ensureContainers(): Promise<void> {
    this.initialization ??= (async () => {
      for (const url of [...Object.values(this.containers), notesMediaContainer(this.podRoot)]) {
        const dataset = new Store();
        new Container(url, dataset, DataFactory).type.add(`${NS.LDP}BasicContainer`);
        try {
          await writeRdf(url, dataset, { createOnly: true, fetchImpl: this.fetchImpl });
        } catch {
          /* Existing containers and unsupported explicit creation are harmless. */
        }
      }
      try {
        await this.register();
      } catch {
        /* Discovery, permission or index failures must never prevent capture. */
      }
    })();
    return this.initialization;
  }

  private async allocate(
    container: string,
    filename: string,
    build: (url: string) => Store,
  ): Promise<StoredNote> {
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";
    for (let suffix = 1; ; suffix++) {
      const url = `${container}${stem}${suffix === 1 ? "" : `-${suffix}`}${extension}`;
      const location = this.scope(url);
      const dataset = build(url);
      try {
        const { etag } = await writeRdf(url, dataset, {
          createOnly: true,
          fetchImpl: this.fetchImpl,
          prefixes: PREFIXES,
        });
        return { ...(parseNote(url, dataset, location) as Note), etag };
      } catch (error) {
        if (error instanceof ResourceWriteError && error.status === 412) continue;
        throw error;
      }
    }
  }

  async create(input: NoteChanges = {}): Promise<StoredNote> {
    await this.ensureContainers();
    return this.allocate(this.containers.active, `${toSlug(input.title) || "note"}.ttl`, (url) =>
      buildNote(url, { ...input, title: input.title ?? "", creator: this.webId, now: this.now() }),
    );
  }

  private input(note: Note): BuildNoteInput {
    return {
      ...note,
      priorRevisions: note.revisions,
      editor: this.webId,
      trashedAt: note.trashedAt,
      previousContainer: note.previous === undefined ? undefined : this.containers[note.previous],
      now: this.now(),
    };
  }

  async save(note: Note, input: NoteChanges, etag: string | null): Promise<StoredNote> {
    this.scope(note.url, note.location);
    const dataset = buildNote(note.url, { ...this.input(note), ...input });
    try {
      const written = await writeRdf(note.url, dataset, {
        etag,
        fetchImpl: this.fetchImpl,
        prefixes: PREFIXES,
      });
      return { ...(parseNote(note.url, dataset, note.location) as Note), etag: written.etag };
    } catch (error) {
      if (error instanceof ResourceWriteError && error.status === 412)
        throw new NoteConflictError(note.url, { cause: error });
      throw error;
    }
  }

  private validator(url: string, etag: string | null): void {
    if (typeof etag !== "string" || !/^"[\x21\x23-\x7e\x80-\xff]*"(?![\s\S])/u.test(etag))
      throw new ConcurrencyValidatorError(url);
  }

  private async remove(url: string, etag: string | null): Promise<void> {
    this.validator(url, etag);
    try {
      await deleteRdf(url, (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("if-match", etag as string);
        return this.fetchImpl(input, { ...init, headers });
      });
    } catch (error) {
      if (error instanceof ResourceDeleteError && error.status === 412)
        throw new NoteConflictError(url, { cause: error });
      throw error;
    }
  }

  private async move(note: StoredNote, action: NoteAction): Promise<StoredNote> {
    this.scope(note.url, note.location);
    const state = reduceNoteState(
      note.location === "trashed"
        ? { status: "trashed", previous: note.previous ?? "active" }
        : { status: note.location },
      action,
    );
    if (state.status === note.location) return note;
    this.validator(note.url, note.etag);
    const sourceEtag = note.etag;
    await this.ensureContainers();
    const filename = new URL(note.url).pathname.split("/").at(-1) as string;
    const moved = await this.allocate(this.containers[state.status], filename, (url) => {
      // Relink every entity, including foreign/imported IDs, without carrying a
      // predecessor back into the old resource. No content revision is added by a move.
      const revisions: Revision[] = note.revisions.map((revision, index) => ({
        ...revision,
        id: revision.id.startsWith(`${note.url}#`)
          ? `${url}${revision.id.slice(note.url.length)}`
          : `${url}#imported-${index}`,
      }));
      for (const [index, revision] of revisions.entries())
        revision.wasRevisionOf = revisions[index + 1]?.id;
      const dataset = buildNote(url, {
        ...this.input(note),
        priorRevisions: revisions,
        now: new Date(revisions[0]?.generatedAt ?? note.modified ?? this.now()),
        trashedAt: state.status === "trashed" ? this.now() : undefined,
        previousContainer: state.status === "trashed" ? this.containers[state.previous] : undefined,
      });
      new NoteDoc(documentSubject(url), dataset, DataFactory).modified = this.now();
      return dataset;
    });
    try {
      await this.remove(note.url, sourceEtag);
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      // Only explicit precondition/auth refusals establish that DELETE did not commit.
      if (status !== 412 && status !== 401 && status !== 403) {
        // Gateway/server failures can also hide a committed DELETE.
        // A different validator belongs to a replacement at the same slug. Keep
        // the original's destination; existence alone cannot justify rollback.
        try {
          const source = await readRdf(note.url, this.fetchImpl);
          if (
            (source.etag !== null && source.etag !== sourceEtag) ||
            new NoteDoc(documentSubject(note.url), source.dataset, DataFactory).body !== note.body
          )
            return moved;
          this.validator(note.url, source.etag);
        } catch (verification) {
          if (
            verification instanceof RdfFetchError &&
            (verification.status === 404 || verification.status === 410)
          )
            return moved;
          throw new NoteMoveUncertainError(note.url, moved.url, {
            cause: new AggregateError([error, verification]),
          });
        }
      }
      try {
        await this.remove(moved.url, moved.etag);
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "Move failed and its new copy could not be removed",
          { cause: error },
        );
      }
      throw error;
    }
    return moved;
  }

  archive(note: StoredNote): Promise<StoredNote> {
    return this.move(note, { type: "archive" });
  }
  unarchive(note: StoredNote): Promise<StoredNote> {
    return this.move(note, { type: "unarchive" });
  }
  trash(note: StoredNote): Promise<StoredNote> {
    return this.move(note, { type: "trash" });
  }
  restore(note: StoredNote): Promise<StoredNote> {
    return this.move(note, { type: "restore" });
  }

  async deleteForever(url: string, etag: string | null): Promise<void> {
    this.scope(url, "trashed");
    await this.remove(url, etag);
  }

  async purgeTrash(olderThanDays = 30): Promise<{ deleted: string[]; failed: NoteFailure[] }> {
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0)
      throw new RangeError("Retention days must be nonnegative and finite");
    const cutoff = this.now().getTime() - olderThanDays * 86_400_000;
    const deleted: string[] = [];
    const failed: NoteFailure[] = [];
    for (const note of await this.list("trashed")) {
      if (note.trashedAt === undefined || !(Date.parse(note.trashedAt) < cutoff)) continue;
      try {
        await this.deleteForever(note.url, note.etag);
        deleted.push(note.url);
      } catch (error) {
        failed.push({ url: note.url, error });
      }
    }
    return { deleted, failed };
  }

  private async labels(
    change: (notes: readonly StoredNote[]) => StoredNote[],
  ): Promise<NoteFailure[]> {
    const notes = [...(await this.list("active")), ...(await this.list("archived"))];
    const changed = change(notes);
    const failed: NoteFailure[] = [];
    for (const [index, note] of changed.entries()) {
      if (note === notes[index]) continue;
      try {
        await this.save(note, { labels: note.labels }, note.etag);
      } catch (error) {
        failed.push({ url: note.url, error });
      }
    }
    return failed;
  }

  renameLabelEverywhere(from: string, to: string): Promise<NoteFailure[]> {
    return this.labels((notes) => mergeLabels(notes, from, to));
  }
  deleteLabelEverywhere(label: string): Promise<NoteFailure[]> {
    return this.labels((notes) => deleteLabel(notes, label));
  }
}

export function createNotesStore(options: NotesStoreOptions): NotesStore {
  return new NotesStore(options);
}
