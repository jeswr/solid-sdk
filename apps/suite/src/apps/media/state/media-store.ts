// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type MediaEntry,
  type MediaRecord,
  type MediaRepository,
  validateEntry,
} from "@jeswr/solid-media-log";
import { StorageError } from "@jeswr/storage-client";
import { entryPatch } from "../lib/view";

interface PendingEdit {
  generation: number;
  id: string;
  patch: Partial<MediaEntry>;
  initial?: MediaEntry | undefined;
}
export interface MediaSnapshot {
  records: MediaRecord[];
  loading: boolean;
  error: boolean;
  incomplete: boolean;
  saving: number;
}
/** Media intent queue: writes run in order against the last confirmed version. */
export class MediaStore {
  private baseline = new Map<string, MediaRecord>();
  private pending: PendingEdit[] = [];
  private listeners = new Set<() => void>();
  private snapshot: MediaSnapshot = {
    records: [],
    loading: true,
    error: false,
    incomplete: false,
    saving: 0,
  };
  private generation = 0;
  private readGeneration = 0;
  private queue = Promise.resolve();
  private active = true;
  constructor(private readonly repository: Promise<MediaRepository>) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(changes: Partial<MediaSnapshot> = {}) {
    if (!this.active) return;
    const records = new Map(this.baseline);
    for (const edit of this.pending) {
      const record = records.get(edit.id);
      if (record) records.set(edit.id, { ...record, data: { ...record.data, ...edit.patch } });
      else if (edit.initial)
        records.set(edit.id, { id: edit.id, url: null, etag: null, data: edit.initial });
    }
    this.snapshot = {
      ...this.snapshot,
      ...changes,
      records: [...records.values()],
      saving: this.pending.length,
    };
    for (const listener of this.listeners) listener();
  }
  async load() {
    const generation = ++this.readGeneration;
    if (this.pending.length) return;
    try {
      const result = await (await this.repository).load();
      if (!this.active || generation !== this.readGeneration || this.pending.length) return;
      this.baseline = new Map(result.records.map((record) => [record.id, record]));
      this.publish({ loading: false, error: false, incomplete: result.incomplete });
    } catch (error) {
      if (generation === this.readGeneration) {
        if (
          error instanceof StorageError &&
          (error.code === "forbidden" || error.code === "unauthenticated")
        )
          this.baseline.clear();
        this.publish({ loading: false, error: true });
      }
    }
  }
  save(input: MediaEntry, existing?: MediaRecord): Promise<void> {
    const data = validateEntry(input);
    const patch = existing ? entryPatch(existing.data, data) : data;
    if (!Object.keys(patch).length) return Promise.resolve();
    const id = existing?.id ?? `new:${crypto.randomUUID()}`;
    const edit: PendingEdit = {
      id,
      generation: ++this.generation,
      patch,
      initial: existing ? undefined : data,
    };
    this.pending.push(edit);
    ++this.readGeneration;
    this.publish();
    const task = this.queue.then(async () => {
      const current = this.baseline.get(id);
      if (!current && !edit.initial) throw new Error("The original item could not be saved");
      const next = validateEntry({
        ...current?.data,
        ...edit.initial,
        ...edit.patch,
      } as MediaEntry);
      const saved = await (await this.repository).save(next, current);
      if (this.active) this.baseline.set(id, { ...saved, id });
    });
    const settled = task.finally(() => {
      this.pending = this.pending.filter((item) => item.generation !== edit.generation);
      this.publish();
    });
    this.queue = settled.catch(() => {});
    return settled;
  }
  dispose() {
    this.active = false;
    ++this.readGeneration;
    this.listeners.clear();
  }
}
