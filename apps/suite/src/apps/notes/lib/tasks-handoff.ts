// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ChecklistItem } from "./capture";

/** The part of the Tasks store a checklist hand-off needs. */
export interface TaskSink<Project extends { tracker: { stateStore?: string | undefined } }> {
  bootstrapInbox(): Promise<Project>;
  listTasks(stateStore: string): Promise<
    readonly {
      url: string;
      task: { rank?: number | undefined; title?: string | undefined; state: string };
    }[]
  >;
  /** Read the current resource without reusing a cached task or listing snapshot. */
  readTask(url: string): Promise<{ task: { title?: string | undefined; state: string } }>;
  createTask(
    project: Project,
    data: { title: string; state: "open"; creator: string; rank: number },
    id: string,
  ): Promise<unknown>;
}

/** One planned task per unchecked, nonempty checklist line. */
export interface PlannedTask {
  readonly id: string;
  readonly title: string;
}

const PRIME = BigInt("0x100000001b3");
const MASK = BigInt("0xffffffffffffffff");
const SEEDS = [BigInt("0xcbf29ce484222325"), BigInt("0x84222325cbf29ce4")] as const;

/** 64-bit FNV-1a, hex. Not a security hash: it only names a task resource stably. */
function fnv(text: string, seed: bigint): string {
  let hash = seed;
  for (const unit of new TextEncoder().encode(text)) {
    hash ^= BigInt(unit);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Task ids are derived from the note's identity and the item (and its repeat count), so
 * sending the same note again, or retrying after a lost response, addresses the same task
 * resources. Creates are conditional, so an item already in Tasks is found, not duplicated.
 */
export function plannedTasks(items: readonly ChecklistItem[], noteKey: string): PlannedTask[] {
  const seen = new Map<string, number>();
  return items
    .filter((item) => !item.checked)
    .map((item) => item.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((title) => {
      const occurrence = seen.get(title) ?? 0;
      seen.set(title, occurrence + 1);
      const key = JSON.stringify([noteKey, title, occurrence]);
      return { id: `note-${fnv(key, SEEDS[0])}${fnv(key, SEEDS[1])}`, title };
    });
}

const status = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error
    ? (error as { status: unknown }).status
    : undefined;

/** How many completed or replaced generations of one item are probed before giving up. */
export const MAX_GENERATIONS = 50;

/**
 * Append the planned tasks to the Tasks Inbox after its last ranked task. Each item has a
 * series of addresses: its planned id, then `<id>-2`, `<id>-3`, … A task found at one
 * (412) counts as already there when it is still open with the same title; a completed
 * or different task, or a foreign resource, moves on to the next address. Each item's
 * generations are read afresh immediately before creating, so deleting an earlier generation
 * cannot hide an already open task at a later one. No extra RDF identity field is needed. An item
 * completed in Tasks can be sent again. Inbox setup errors are thrown for the caller to classify.
 * Remaining race: two tabs converting the same item at the same instant after a deletion can
 * still create two open tasks if one creates a later generation between the other's probe and
 * its conditional create.
 */
export async function sendToTasks<Project extends { tracker: { stateStore?: string | undefined } }>(
  store: TaskSink<Project>,
  tasks: readonly PlannedTask[],
  creator: string,
): Promise<{ created: number; existing: number; failed: PlannedTask[] }> {
  const inbox = await store.bootstrapInbox();
  const stateStore = inbox.tracker.stateStore;
  if (!stateStore) throw new TypeError("Inbox has no stateStore.");
  const current = await store.listTasks(stateStore);
  const ranks = current
    .map((item) => item.task.rank)
    .filter((rank): rank is number => rank !== undefined && Number.isFinite(rank));
  let rank = Math.max(0, ...ranks);
  let created = 0;
  let existing = 0;
  const failed: PlannedTask[] = [];
  for (const task of tasks) {
    const ids = Array.from({ length: MAX_GENERATIONS }, (_, index) =>
      index === 0 ? task.id : `${task.id}-${index + 1}`,
    );
    let outcome: "created" | "existing" | "failed" = "failed";
    try {
      // TaskStore reads bypass caches; the batch listing is only used for ranks.
      const open = await Promise.all(
        ids.map(async (id) => {
          try {
            const found = await store.readTask(`${stateStore}${id}.ttl`);
            return found.task.state === "open" && found.task.title === task.title;
          } catch (error) {
            if (status(error) === 404 || status(error) === 410) return false;
            if (error instanceof TypeError && error.message === "Expected a wf:Task.") return false;
            throw error;
          }
        }),
      );
      if (open.some(Boolean)) {
        existing++;
        continue;
      }
      rank += 1;
      const data = { title: task.title, state: "open" as const, creator, rank };
      for (const id of ids) {
        try {
          await store.createTask(inbox, data, id);
          outcome = "created";
          break;
        } catch (error) {
          if (status(error) !== 412) throw error;
        }
        try {
          const found = await store.readTask(`${stateStore}${id}.ttl`);
          if (found.task.state === "open" && found.task.title === task.title) {
            outcome = "existing";
            break;
          }
        } catch (error) {
          // TaskStore distinguishes a readable foreign resource from failed reads.
          if (error instanceof TypeError && error.message === "Expected a wf:Task.") continue;
          throw error;
        }
      }
    } catch {
      outcome = "failed";
    }
    if (outcome === "created") created++;
    else if (outcome === "existing") existing++;
    else failed.push(task);
  }
  return { created, existing, failed };
}
