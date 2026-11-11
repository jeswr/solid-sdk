// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type MediaEntry,
  type MediaRecord,
  type MediaRepository,
  type MediaSkip,
  mediaImportIndex,
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
export interface MediaImportJob {
  running: boolean;
  checking: boolean;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  error?: "incomplete-library";
}
export interface MediaSnapshot {
  records: MediaRecord[];
  loading: boolean;
  error: boolean;
  incomplete: boolean;
  saving: number;
  skipped: MediaSkip[];
  importJob: MediaImportJob | null;
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
    skipped: [],
    importJob: null,
  };
  private generation = 0;
  private readGeneration = 0;
  private queue = Promise.resolve();
  private active = true;
  private importController: AbortController | undefined;
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
    if (this.pending.length || this.importController) return;
    try {
      const result = await (await this.repository).load();
      if (
        !this.active ||
        generation !== this.readGeneration ||
        this.pending.length ||
        this.importController
      )
        return;
      const records = new Map(result.records.map((record) => [record.id, record]));
      const confirmedUrls = new Set(result.records.map((record) => record.url));
      const skippedUrls = new Set(result.skipped?.map((item) => item.url));
      if (result.incomplete || skippedUrls.size) {
        for (const record of this.baseline.values())
          if (
            record.unconfirmed &&
            !confirmedUrls.has(record.url) &&
            (result.incomplete || (record.url && skippedUrls.has(record.url)))
          )
            records.set(record.id, record);
      }
      this.baseline = records;
      this.publish({
        loading: false,
        error: false,
        incomplete: result.incomplete,
        skipped: result.skipped ?? [],
      });
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
  /** One session-scoped job; scans all existing records before optimistic batch insertion. */
  async importEntries(entries: readonly MediaEntry[], skipped = 0): Promise<MediaImportJob> {
    if (this.importController) throw new Error("An import is already running");
    const controller = new AbortController();
    this.importController = controller;
    ++this.readGeneration;
    const job: MediaImportJob = {
      running: true,
      checking: true,
      total: entries.length,
      processed: 0,
      imported: 0,
      skipped,
      failed: 0,
      cancelled: false,
    };
    let scan: Partial<MediaSnapshot> = {};
    const publish = () => this.publish({ ...scan, importJob: { ...job } });
    publish();
    const edits: PendingEdit[] = [];
    const targets = new Map<string, MediaRecord>();
    try {
      await this.queue;
      const repository = await this.repository;
      const listing = await repository.load({ complete: true, signal: controller.signal });
      if (controller.signal.aborted || !this.active) return job;
      scan = { incomplete: listing.incomplete, skipped: listing.skipped ?? [] };
      if (listing.incomplete) {
        job.error = "incomplete-library";
        throw new Error("Could not check the complete library for duplicates");
      }
      // Prefer freshly observed ETags while retaining optimistic records' stable local IDs.
      const records = new Map(
        this.snapshot.records.map((record) => [record.url ?? record.id, record]),
      );
      for (const record of listing.records) {
        const key = record.url ?? record.id;
        records.set(key, { ...record, id: records.get(key)?.id ?? record.id });
      }
      const byData = new Map([...records.values()].map((record) => [record.data, record]));
      const known = mediaImportIndex(byData.keys());
      for (const input of entries) {
        try {
          const data = validateEntry(input);
          if (known.has(data)) {
            job.skipped++;
            job.processed++;
            continue;
          }
          const targetData = known.completionTarget(data);
          const target = targetData ? byData.get(targetData) : undefined;
          const next = target
            ? validateEntry({
                ...target.data,
                ...Object.fromEntries(
                  Object.entries(data).filter(([, value]) => value !== undefined),
                ),
              })
            : data;
          known.add(data);
          if (target) {
            targets.set(target.id, target);
            this.baseline.set(target.id, target);
          }
          edits.push({
            id: target?.id ?? `new:${crypto.randomUUID()}`,
            generation: ++this.generation,
            patch: target ? entryPatch(target.data, next) : next,
            initial: target ? undefined : next,
          });
        } catch {
          job.failed++;
          job.processed++;
        }
      }
      job.checking = false;
      this.pending.push(...edits);
      publish();
      for (
        let offset = 0;
        offset < edits.length && !controller.signal.aborted && this.active;
        offset += 6
      ) {
        const batch = edits.slice(offset, offset + 6);
        await Promise.all(
          batch.map(async (edit) => {
            try {
              const target = targets.get(edit.id);
              const saved = await repository.save(
                validateEntry({ ...target?.data, ...edit.patch } as MediaEntry),
                target,
              );
              if (this.active) this.baseline.set(edit.id, { ...saved, id: edit.id });
              job.imported++;
            } catch {
              job.failed++;
            }
            job.processed++;
          }),
        );
        const settled = new Set(batch.map((edit) => edit.generation));
        this.pending = this.pending.filter((edit) => !settled.has(edit.generation));
        publish();
      }
    } catch {
      if (!controller.signal.aborted) job.failed += job.total - job.processed;
    } finally {
      job.cancelled = controller.signal.aborted;
      job.running = false;
      job.checking = false;
      const remaining = new Set(edits.map((edit) => edit.generation));
      this.pending = this.pending.filter((edit) => !remaining.has(edit.generation));
      this.importController = undefined;
      publish();
    }
    return { ...job };
  }
  cancelImport() {
    this.importController?.abort();
  }
  dispose() {
    this.active = false;
    this.cancelImport();
    ++this.readGeneration;
    this.listeners.clear();
  }
}
