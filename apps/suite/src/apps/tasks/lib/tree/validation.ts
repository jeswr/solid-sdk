// AUTHORED-BY Codex GPT-6.1-Sol
import { TaskTreeError, type TreeTask } from "./types";

export function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TaskTreeError("invalid-input", message);
}

export function identifier(value: unknown): asserts value is string {
  requireInput(typeof value === "string" && value.trim().length > 0, "Expected a task ID");
}

export interface Forest<T extends TreeTask> {
  readonly byId: Map<string, T>;
  readonly children: Map<string | undefined, T[]>;
}

/** Validate the entire snapshot, including disconnected cycles and unrelated malformed tasks. */
export function readForest<T extends TreeTask>(tasks: readonly T[]): Forest<T> {
  requireInput(Array.isArray(tasks), "Expected a complete task array");
  const byId = new Map<string, T>();
  const children = new Map<string | undefined, T[]>();
  for (const task of tasks) {
    requireInput(
      task !== null && typeof task === "object" && !Array.isArray(task),
      "Expected a task",
    );
    identifier(task.id);
    if (task.parentId !== undefined) identifier(task.parentId);
    requireInput(task.state === "open" || task.state === "completed", "Unknown completion state");
    if (
      typeof task.orderKey !== "string" ||
      !/^[0-9A-Za-z]+$/.test(task.orderKey) ||
      task.orderKey.endsWith("0")
    ) {
      throw new TaskTreeError("invalid-order", "Expected a base-62 fractional ordering key");
    }
    if (byId.has(task.id)) throw new TaskTreeError("invalid-tree", "Duplicate task ID");
    byId.set(task.id, task);
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
    for (let i = 1; i < siblings.length; i++) {
      if ((siblings[i - 1] as T).orderKey === (siblings[i] as T).orderKey) {
        throw new TaskTreeError("invalid-order", "Sibling ordering keys collide");
      }
    }
  }
  const checked = new Set<string>();
  for (const task of tasks) {
    const path = new Set<string>();
    let current: T | undefined = task;
    while (current !== undefined && !checked.has(current.id)) {
      if (path.has(current.id)) throw new TaskTreeError("cycle", "Task hierarchy contains a cycle");
      path.add(current.id);
      const parent = current.parentId;
      current = parent === undefined ? undefined : byId.get(parent);
      if (parent !== undefined && current === undefined) {
        throw new TaskTreeError("invalid-tree", "Parent is absent from the complete snapshot");
      }
    }
    for (const id of path) checked.add(id);
  }
  return { byId, children };
}

export function getTask<T extends TreeTask>(forest: Forest<T>, id: string): T {
  identifier(id);
  const task = forest.byId.get(id);
  if (task === undefined)
    throw new TaskTreeError("task-not-found", "Task is absent from the snapshot");
  return task;
}

/** Iterative traversal avoids a call-stack limit for deeply nested valid trees. */
export function descendants<T extends TreeTask>(forest: Forest<T>, id: string): T[] {
  const result: T[] = [];
  const pending = [...(forest.children.get(id) ?? [])];
  while (pending.length > 0) {
    const task = pending.pop() as T;
    result.push(task);
    for (const child of forest.children.get(task.id) ?? []) pending.push(child);
  }
  return result;
}
