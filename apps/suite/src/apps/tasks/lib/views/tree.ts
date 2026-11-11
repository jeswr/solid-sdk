// AUTHORED-BY Codex GPT-6.1-Sol
import { generateNKeysBetween } from "../../../../lib/order";
import { positionBetween } from "../model/task";
import { getProgress, indentTask, outdentTask, type TreeTask } from "../tree";
import { compareTasks, type Row, taskIndex, taskSection } from "./project-groups";
import type { TaskView } from "./types";

/** Progress uses the library's default: direct children, including completed/hidden ones. */
export function taskProgress(tasks: readonly TaskView[], id: string) {
  const children = tasks.filter((task) => task.parentId === id && task.id !== id);
  const keys = generateNKeysBetween(null, null, children.length + 1);
  return getProgress(
    [
      { id, state: "open", orderKey: keys[0] as string },
      ...children.map(
        (task, index): TreeTask => ({
          id: task.id,
          parentId: id,
          state: task.state === "closed" ? "completed" : "open",
          orderKey: keys[index + 1] as string,
        }),
      ),
    ],
    id,
  );
}

interface OrderingForest {
  projectUrl: string;
  project: TaskView[];
  section: string | undefined;
  domain: TaskView[];
  forest: TreeTask[];
}
const forests = new WeakMap<readonly TaskView[], OrderingForest[]>();
/** Build each complete project/section forest once for an immutable view snapshot. */
function orderingForest(tasks: readonly TaskView[], active: TaskView): OrderingForest {
  let snapshot = forests.get(tasks);
  if (!snapshot) {
    snapshot = [];
    forests.set(tasks, snapshot);
  }
  const project =
    snapshot.find((entry) => entry.projectUrl === active.projectUrl)?.project ??
    tasks.filter((task) => task.projectUrl === active.projectUrl);
  const section = taskSection(active, project, true);
  const existing = snapshot.find(
    (entry) => entry.projectUrl === active.projectUrl && entry.section === section,
  );
  if (existing) return existing;
  const domain = project
    .filter((task) => taskSection(task, project, true) === section)
    .sort(compareTasks("manual"));
  const keys = generateNKeysBetween(null, null, domain.length);
  const forest = domain.map(
    (task, index): TreeTask => ({
      id: task.id,
      ...(task.parentId ? { parentId: task.parentId } : {}),
      orderKey: keys[index] as string,
      state: task.state === "closed" ? "completed" : "open",
    }),
  );
  const entry = { projectUrl: active.projectUrl, project, section, domain, forest };
  snapshot.push(entry);
  return entry;
}

/** Keep an unfiltered ordering domain; adapt fractional keys back to schema:position. */
export function planTreeMove(tasks: readonly TaskView[], active: TaskView, outdent: boolean) {
  const { domain, forest } = orderingForest(tasks, active);
  try {
    const moved = (outdent ? outdentTask : indentTask)(forest, active.id);
    const root = moved.find((task) => task.id === active.id) as TreeTask;
    const siblings = moved
      .filter((task) => task.parentId === root.parentId)
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
    const at = siblings.indexOf(root);
    const rank = (index: number) =>
      domain.find((task) => task.id === siblings[index]?.id)?.position;
    const before = rank(at - 1);
    const after = rank(at + 1);
    if ((siblings[at - 1] && before === undefined) || (siblings[at + 1] && after === undefined))
      return;
    const { position } = positionBetween(before, after);
    // A move writes exactly one root. Never renumber unrelated siblings.
    if (position <= (before ?? -Infinity) || position >= (after ?? Infinity)) return;
    return { parentId: root.parentId, position };
  } catch {
    // Boundaries and malformed/partial foreign forests cannot be structurally edited.
    return;
  }
}

export function expandedRows(rows: readonly Row[], collapsed: ReadonlySet<string>): Row[] {
  let hiddenBelow = Infinity;
  return rows.filter((row) => {
    if (row.depth > hiddenBelow) return false;
    hiddenBelow = collapsed.has(row.task.id) ? row.depth : Infinity;
    return true;
  });
}

/** True ancestry remains available even when a closed/filtered parent is displayed separately. */
export function taskLevel(task: TaskView, tasks: readonly TaskView[]): number {
  const byId = taskIndex(tasks);
  const seen = new Set([task.id]);
  let parent = task.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    parent = byId.get(parent)?.parentId;
  }
  return seen.size;
}
