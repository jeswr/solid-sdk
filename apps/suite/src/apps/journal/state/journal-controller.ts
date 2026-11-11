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
};
export interface JournalSnapshot {
  entries: JournalEntry[];
  loading: boolean;
  error: boolean;
  saving: number;
  failed: { data: EntryData | null; photos?: Blob[]; existing?: JournalEntry }[];
}

/** One account owns each controller. Serial writes use the latest confirmed ETag. */
export class JournalController {
  private baseline = new Map<string, JournalEntry>();
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
      const entries = await this.store.list();
      if (generation !== this.readGeneration || writes !== this.generation || this.edits.length)
        return;
      this.baseline = new Map(entries.map((entry) => [entry.url, entry]));
      this.publish({ loading: false, error: false });
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
      this.publish({ loading: false, error: true });
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
      const current = this.baseline.get(edit.key) ?? edit.existing;
      try {
        if (edit.data) {
          edit.photos ??= [];
          while (edit.photos.length) {
            const photo = edit.photos[0] as Blob;
            const image = await this.store.attach(photo);
            edit.data = { ...edit.data, images: [...(edit.data.images ?? []), image] };
            edit.photos = edit.photos.slice(1);
          }
          const result = await this.store.save(edit.data, current);
          this.baseline.delete(edit.key);
          this.baseline.set(result.url, result);
          if (current)
            this.snapshot = {
              ...this.snapshot,
              failed: this.snapshot.failed.filter((failed) => failed.existing?.url !== current.url),
            };
          // Later edits to a just-created record follow the server-assigned URL.
          for (const later of this.edits)
            if (later.id > edit.id && later.key === edit.key) later.key = result.url;
        } else if (current) {
          await this.store.remove(current);
          this.baseline.delete(edit.key);
        }
      } catch {
        this.snapshot = {
          ...this.snapshot,
          failed: [
            ...this.snapshot.failed,
            {
              data: edit.data,
              photos: edit.photos ?? [],
              ...(current ? { existing: current } : {}),
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
    const failed = this.snapshot.failed;
    this.publish({ failed: [] });
    for (const edit of failed) {
      if (edit.data) this.save(edit.data, edit.existing, edit.photos);
      else if (edit.existing) this.remove(edit.existing);
    }
  }
  settled(): Promise<void> {
    return this.queue;
  }
}
