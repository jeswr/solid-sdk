// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type EntryData,
  type JournalEntry,
  JournalPrivacyError,
  type JournalStore,
} from "@jeswr/solid-journal";

type Edit = {
  id: number;
  key: string;
  data: EntryData | null;
  photos?: Blob[];
  existing?: JournalEntry;
  overwrite?: boolean;
};
type FailedEdit = Omit<Edit, "overwrite"> & { conflict: boolean };
export interface JournalSnapshot {
  entries: JournalEntry[];
  loading: boolean;
  error: boolean;
  saving: number;
  failed: FailedEdit[];
  skipped: number;
  needsPrivacy: boolean;
  privacyMessage: string | null;
}

/** Keep observed validators; resolve missing ones only after this tab's pending write. */
export class JournalController {
  private baseline = new Map<string, JournalEntry>();
  private confirmed = new Map<string, Map<string, JournalEntry>>();
  private edits: Edit[] = [];
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private generation = 0;
  private readGeneration = 0;
  private snapshot: JournalSnapshot = {
    entries: [],
    loading: true,
    error: false,
    saving: 0,
    failed: [],
    skipped: 0,
    needsPrivacy: false,
    privacyMessage: null,
  };
  constructor(
    private store: JournalStore,
    private onFailure: () => void,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<JournalSnapshot> = {}) {
    const visible = new Map(this.baseline);
    for (const edit of this.edits) {
      if (edit.data) visible.set(edit.key, { ...edit.data, url: edit.key, etag: null });
      else visible.delete(edit.key);
    }
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      entries: [...visible.values()].sort((a, b) => b.created.getTime() - a.created.getTime()),
      saving: this.edits.length,
    };
    for (const listener of this.listeners) listener();
  }
  async load() {
    const generation = ++this.readGeneration;
    const writes = this.generation;
    try {
      let skipped = 0;
      const entries = await this.store.list({ onPrivacySkip: () => skipped++ });
      if (generation !== this.readGeneration || writes !== this.generation || this.edits.length)
        return;
      this.baseline = new Map(entries.map((entry) => [entry.url, entry]));
      this.publish({
        loading: false,
        error: false,
        skipped,
        needsPrivacy: false,
        privacyMessage: null,
      });
    } catch (error) {
      if (generation !== this.readGeneration) return;
      if (
        error instanceof JournalPrivacyError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          ["forbidden", "unauthenticated", "unsupported"].includes(String(error.code)))
      )
        this.baseline.clear();
      this.publish({
        loading: false,
        error: true,
        needsPrivacy: error instanceof JournalPrivacyError && error.canMakePrivate,
        privacyMessage: error instanceof JournalPrivacyError ? error.message : null,
      });
    }
  }
  save(data: EntryData, existing?: JournalEntry, photos: Blob[] = []): void {
    this.enqueue({
      id: ++this.generation,
      key: existing?.url ?? `draft:${crypto.randomUUID()}`,
      data,
      photos,
      ...(existing ? { existing } : {}),
    });
  }
  remove(existing: JournalEntry): void {
    this.enqueue({ id: ++this.generation, key: existing.url, data: null, existing });
  }
  private enqueue(edit: Edit) {
    this.edits.push(edit);
    ++this.readGeneration;
    this.publish();
    this.queue = this.queue.then(async () => {
      let current = edit.existing;
      try {
        if (edit.overwrite) {
          // Explicit user choice only. Even Overwrite uses a fresh conditional validator.
          current = edit.key.startsWith("draft:") ? undefined : await this.store.read(edit.key);
        } else {
          if (current?.url.startsWith("draft:")) current = undefined;
          const seen = new Set<string>();
          while (current?.etag && !seen.has(current.etag)) {
            seen.add(current.etag);
            const next = this.confirmed.get(edit.key)?.get(current.etag);
            if (!next) break;
            current = next;
          }
          if (this.snapshot.failed.some((failed) => failed.key === edit.key && failed.conflict))
            throw Object.assign(new Error("Resolve the conflicting entry before saving."), {
              code: "precondition-failed",
            });
          if (current && !current.etag) current = await this.store.read(current.url);
        }
        if (edit.data) {
          const uploaded: string[] = [];
          edit.photos ??= [];
          while (edit.photos.length) {
            const photo = edit.photos[0] as Blob;
            const image = await this.store.attach(photo);
            uploaded.push(image);
            edit.data = { ...edit.data, images: [...(edit.data.images ?? []), image] };
            edit.photos = edit.photos.slice(1);
          }
          const result = await this.store.save(edit.data, current);
          if (current?.etag) {
            const chain = this.confirmed.get(edit.key) ?? new Map<string, JournalEntry>();
            chain.set(current.etag, result);
            this.confirmed.set(edit.key, chain);
          }
          this.baseline.delete(edit.key);
          this.baseline.set(result.url, result);
          const currentUrl = current?.url;
          if (currentUrl)
            this.snapshot = {
              ...this.snapshot,
              failed: this.snapshot.failed.filter(
                (failed) => failed.conflict || failed.existing?.url !== currentUrl,
              ),
            };
          // Optimistic entries have no validator (and new ones have a draft URL).
          // They follow our completed write, including its server-assigned URL.
          for (const later of this.edits)
            if (later.id > edit.id && later.key === edit.key) {
              later.key = result.url;
              if (!later.existing?.etag || later.existing.url.startsWith("draft:"))
                later.existing = result;
              if (later.data && uploaded.length)
                later.data = {
                  ...later.data,
                  images: [...new Set([...(later.data.images ?? []), ...uploaded])],
                };
            }
        } else if (current) {
          await this.store.remove(current);
          this.baseline.delete(edit.key);
          this.confirmed.delete(edit.key);
        }
      } catch (error) {
        this.snapshot = {
          ...this.snapshot,
          failed: [
            ...this.snapshot.failed,
            {
              id: edit.id,
              key: edit.key,
              data: edit.data,
              photos: edit.photos ?? [],
              ...(current ? { existing: current } : {}),
              conflict:
                edit.overwrite === true ||
                (typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "precondition-failed"),
            },
          ],
        };
        this.onFailure();
      } finally {
        this.edits = this.edits.filter((item) => item.id !== edit.id);
        this.publish();
        if (!this.edits.length) await this.load();
      }
    });
  }
  retryFailed(): void {
    const failed = this.snapshot.failed.filter((edit) => !edit.conflict);
    this.publish({ failed: this.snapshot.failed.filter((edit) => edit.conflict) });
    for (const edit of failed) {
      this.enqueue({ ...edit, id: ++this.generation });
    }
  }
  overwriteFailed(id: number): void {
    const edit = this.snapshot.failed.find((edit) => edit.id === id && edit.conflict);
    if (!edit) return;
    this.discardFailed(id);
    // A conflicted create has no observed resource to overwrite. A new input identity
    // explicitly starts a fresh create instead of resuming its interrupted URL.
    const data = edit.key.startsWith("draft:") && edit.data ? { ...edit.data } : edit.data;
    this.enqueue({ ...edit, data, id: ++this.generation, overwrite: true });
  }
  discardFailed(id: number): void {
    this.publish({ failed: this.snapshot.failed.filter((edit) => edit.id !== id) });
  }
  async makePrivate(): Promise<void> {
    try {
      await this.store.makePrivate();
      await this.load();
    } catch (error) {
      if (error instanceof JournalPrivacyError) this.publish({ privacyMessage: error.message });
      this.onFailure();
    }
  }
  settled(): Promise<void> {
    return this.queue;
  }
}
