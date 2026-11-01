// AUTHORED-BY Codex GPT-6.1-Sol
import { isomorphic } from "rdf-isomorphic";
import { ModelError } from "./errors";
import type { RdfIO, Resource } from "./io";
import { DataFactory, Store } from "./rdf";
import type { StoredTask } from "./store";
import { TaskItem } from "./task";

interface ReferenceMove {
  original: StoredTask;
  intended: Store;
}
const same = (a: Resource["dataset"], b: Resource["dataset"]) => isomorphic([...a], [...b]);
const stored = (resource: Resource): StoredTask => ({
  ...resource,
  task: new TaskItem(`${resource.url}#it`, resource.dataset, DataFactory),
});

/** One move intent, retained across retries, including ambiguous writes and compensation. */
export class TaskMove {
  readonly references = new Map<string, StoredTask>();
  private plan!: ReferenceMove[];
  private rollingBack = false;
  private replan = false;
  private result: StoredTask | undefined;
  constructor(
    private readonly io: RdfIO,
    private readonly source: StoredTask,
    private readonly destination: { url: string; dataset: Store },
    private readonly listReferences: () => Promise<StoredTask[]>,
    private readonly modified: Date,
  ) {}

  /** A definite rejection was fully compensated; Retry may use fresh resources. */
  get canReplan(): boolean {
    return this.replan;
  }

  /** Read before retrying; a lost response is success only when the intended data is present. */
  private async write(url: string, dataset: Store, etag?: string | null): Promise<StoredTask> {
    const current = await this.io.optional(url);
    if (current && same(current.dataset, dataset)) return stored(current);
    if (etag === undefined ? current !== undefined : current?.etag !== etag)
      throw new ModelError(412, url, current?.etag);
    try {
      return stored(
        await this.io.write(url, dataset, etag === undefined ? { create: true } : { etag }),
      );
    } catch (error) {
      const confirmed = await this.io.optional(url);
      if (confirmed && same(confirmed.dataset, dataset)) return stored(confirmed);
      throw error;
    }
  }

  private async rollback(): Promise<void> {
    // No compensation is safe until we know the original survived.
    if (!(await this.io.optional(this.source.url))) throw new ModelError(409, this.source.url);
    for (const reference of [...this.plan].reverse()) {
      const current = await this.io.optional(reference.original.url);
      if (!current) continue; // A separately deleted task no longer references either copy.
      const task = stored(current);
      if (
        task.task.parent !== `${this.destination.url}#it` &&
        task.task.clonedFrom !== `${this.destination.url}#it`
      ) {
        if (same(current.dataset, reference.original.dataset)) reference.original = task;
        continue;
      }
      if (!same(current.dataset, reference.intended))
        throw new ModelError(412, current.url, current.etag);
      // Restore only our revision. A failed/lost rollback is reconciled by write().
      reference.original = await this.write(current.url, reference.original.dataset, current.etag);
    }
    // Recheck after rolling references back; retain the destination if the source disappeared.
    if (!(await this.io.optional(this.source.url))) throw new ModelError(409, this.source.url);
    const destination = await this.io.optional(this.destination.url);
    if (destination) {
      if (!same(destination.dataset, this.destination.dataset))
        throw new ModelError(412, destination.url, destination.etag);
      try {
        await this.io.remove(destination.url, destination.etag);
      } catch (error) {
        if (await this.io.optional(destination.url)) throw error;
      }
    }
    this.rollingBack = false;
    this.references.clear();
  }

  async run(): Promise<StoredTask> {
    if (this.result) return this.result;
    this.replan = false;
    if (this.rollingBack) {
      if (await this.io.optional(this.source.url)) await this.rollback();
      else this.rollingBack = false; // Finish forward if the source vanished during rollback.
    }
    this.plan ??= (await this.listReferences()).map((original) => {
      const intended = new Store([...original.dataset]);
      const task = new TaskItem(original.task.id, intended, DataFactory);
      if (task.parent === this.source.task.id) task.parent = `${this.destination.url}#it`;
      if (task.clonedFrom === this.source.task.id) task.clonedFrom = `${this.destination.url}#it`;
      task.modified = this.modified;
      return { original, intended };
    });
    let moved: StoredTask | undefined;
    let deleting = false;
    try {
      moved = await this.write(this.destination.url, this.destination.dataset);
      for (const reference of this.plan) {
        const updated = await this.write(
          reference.original.url,
          reference.intended,
          reference.original.etag,
        );
        this.references.set(updated.url, updated);
      }
      deleting = true;
      await this.io.remove(this.source.url, this.source.etag);
    } catch (error) {
      // DELETE may have committed even though fetch rejected. An unreadable source
      // leaves the destination and task references intact for reconciliation on Retry.
      const source = await this.io.optional(this.source.url);
      if (!source) {
        if (deleting && moved) {
          this.result = moved;
          return moved;
        }
        throw error;
      }
      // Existence alone cannot reconcile an ambiguous DELETE if another writer
      // replaced the original. Keep its captured data at the destination too.
      const rejected = error instanceof ModelError && error.status >= 400 && error.status < 500;
      if (deleting && !same(source.dataset, this.source.dataset) && !rejected) throw error;
      this.rollingBack = true;
      try {
        await this.rollback();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Couldn't finish moving the task; both copies were retained.",
        );
      }
      this.replan = rejected;
      throw error;
    }
    this.result = moved;
    return moved;
  }
}
