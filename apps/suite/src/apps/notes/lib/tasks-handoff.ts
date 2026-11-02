// AUTHORED-BY Claude Opus 5.5
import type { ChecklistItem } from "./capture";

/** The part of the Tasks store a checklist hand-off needs. */
export interface TaskSink<Project> {
  bootstrapInbox(): Promise<Project>;
  createTask(
    project: Project,
    data: { title: string; state: "open"; creator: string },
    id: string,
  ): Promise<unknown>;
}

/** One planned task per unchecked, nonempty checklist line, each with a stable id. */
export interface PlannedTask {
  readonly id: string;
  readonly title: string;
}

/** Task titles are single-line; collapse whitespace and keep the visible text. */
export function plannedTasks(
  items: readonly ChecklistItem[],
  uuid: () => string = () => crypto.randomUUID(),
): PlannedTask[] {
  return items
    .filter((item) => !item.checked)
    .map((item) => item.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((title) => ({ id: uuid(), title }));
}

const status = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error
    ? (error as { status: unknown }).status
    : undefined;

/**
 * Create the planned tasks in the Tasks Inbox. Ids are fixed per plan and creates are
 * conditional, so a retry after a lost response finds the task already there (412) and
 * counts it as created instead of adding a duplicate.
 */
export async function sendToTasks<Project>(
  store: TaskSink<Project>,
  tasks: readonly PlannedTask[],
  creator: string,
): Promise<{ created: number; failed: PlannedTask[] }> {
  const inbox = await store.bootstrapInbox();
  let created = 0;
  const failed: PlannedTask[] = [];
  for (const task of tasks) {
    try {
      await store.createTask(inbox, { title: task.title, state: "open", creator }, task.id);
      created++;
    } catch (error) {
      if (status(error) === 412) created++;
      else failed.push(task);
    }
  }
  return { created, failed };
}
