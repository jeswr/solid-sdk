// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Validated maps and bounded array indices establish these entries.
import { generateKeyBetween, generateNKeysBetween } from "../../../../lib/order";
import type { BoardChange, BoardColumn, BoardTask } from "./types";
import { BoardError, identifier, requireInput, uniqueStrings } from "./validation";

/** Status definitions are ordered, unique identifiers, with no implicit default column. */
export function groupByStatus<T extends BoardTask>(
  tasks: readonly T[],
  statuses: readonly string[],
): BoardColumn<T>[] {
  uniqueStrings(statuses);
  requireInput(Array.isArray(tasks), "Expected a task array");
  const groups = new Map(statuses.map((status) => [status, [] as T[]]));
  const ids = new Set<string>();
  const keys = new Map(statuses.map((status) => [status, new Set<string>()]));
  for (const task of tasks) {
    requireInput(task !== null && typeof task === "object", "Expected a task projection");
    identifier(task.id);
    identifier(task.status);
    requireInput(!ids.has(task.id), "Duplicate task identifier");
    ids.add(task.id);
    const column = groups.get(task.status);
    if (!column) throw new BoardError("unknown-status", "Task status has no configured column");
    // Validate before calling the shared order utility so all failures have a typed board error.
    if (
      typeof task.orderKey !== "string" ||
      task.orderKey.length === 0 ||
      /[^0-9A-Za-z]/.test(task.orderKey) ||
      task.orderKey.endsWith("0") ||
      keys.get(task.status)!.has(task.orderKey)
    ) {
      throw new BoardError("invalid-order", "Malformed or colliding order key in a column");
    }
    keys.get(task.status)!.add(task.orderKey);
    column.push(task);
  }
  return statuses.map((status) => {
    const column = groups.get(status)!;
    column.sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
    return { status, tasks: column, wipCount: column.length };
  });
}

/**
 * Return a patch for one move. Index addresses the destination AFTER removing the moved task.
 * Existing tasks keep their keys; a move to the same slot returns []. Apply against this snapshot
 * atomically/conditionally: identical concurrent insertions can produce colliding keys.
 */
export function moveToColumn(
  tasks: readonly BoardTask[],
  statuses: readonly string[],
  taskId: string,
  status: string,
  index: number,
): BoardChange[] {
  const columns = groupByStatus(tasks, statuses);
  identifier(taskId);
  identifier(status);
  const task = tasks.find((item) => item.id === taskId);
  requireInput(task, "Unknown task identifier");
  const target = columns.find((column) => column.status === status);
  if (!target)
    throw new BoardError("unknown-status", "Destination status has no configured column");
  const remaining = target.tasks.filter((item) => item.id !== taskId);
  requireInput(
    Number.isSafeInteger(index) && index >= 0 && index <= remaining.length,
    "Destination index is outside the column",
  );
  if (task.status === status && target.tasks[index]?.id === taskId) return [];
  return [
    {
      id: taskId,
      status,
      orderKey: generateKeyBetween(
        remaining[index - 1]?.orderKey ?? null,
        remaining[index]?.orderKey ?? null,
      ),
    },
  ];
}

/**
 * Reorder one entire column, returning the minimum number of changed keys. A longest increasing
 * subsequence retains existing keys; balanced keys fill its gaps. Ties retain the earliest ending
 * subsequence in desired order. IDs must be an exact permutation, never a filtered subset.
 */
export function bulkReorderDiff(
  tasks: readonly BoardTask[],
  statuses: readonly string[],
  status: string,
  orderedIds: readonly string[],
): BoardChange[] {
  const columns = groupByStatus(tasks, statuses);
  identifier(status);
  uniqueStrings(orderedIds);
  const column = columns.find((item) => item.status === status);
  if (!column) throw new BoardError("unknown-status", "Reordered status has no configured column");
  const byId = new Map(column.tasks.map((task) => [task.id, task]));
  requireInput(
    orderedIds.length === byId.size && orderedIds.every((id) => byId.has(id)),
    "Reorder must contain every task in the column exactly once",
  );
  const desired = orderedIds.map((id) => byId.get(id)!);
  // Dynamic programming keeps the minimal-change rule explicit; O(n²) time, O(n) space.
  const lengths = desired.map(() => 1);
  const previous = desired.map(() => -1);
  let end = -1;
  for (let i = 0; i < desired.length; i++) {
    for (let j = 0; j < i; j++) {
      if (desired[j]!.orderKey < desired[i]!.orderKey && lengths[j]! + 1 > lengths[i]!) {
        lengths[i] = lengths[j]! + 1;
        previous[i] = j;
      }
    }
    if (end === -1 || lengths[i]! > lengths[end]!) end = i;
  }
  const retained = new Set<number>();
  for (let i = end; i !== -1; i = previous[i]!) retained.add(i);
  const changes: BoardChange[] = [];
  let start = 0;
  let lower: string | null = null;
  for (let i = 0; i <= desired.length; i++) {
    if (i < desired.length && !retained.has(i)) continue;
    const upper = desired[i]?.orderKey ?? null;
    const keys = generateNKeysBetween(lower, upper, i - start);
    for (let offset = 0; offset < keys.length; offset++) {
      changes.push({ id: desired[start + offset]!.id, status, orderKey: keys[offset]! });
    }
    lower = upper;
    start = i + 1;
  }
  return changes;
}
