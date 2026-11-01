// AUTHORED-BY Codex GPT-6.1-Sol
import { positionBetween } from "../model/task";
import type { TaskView } from "./types";

export interface DropPosition {
  position: number;
  renumber?: { url: string; position: number }[];
}

/**
 * Index is an insertion slot, 0…siblings.length; remove the moving row first.
 * Renumber patches apply to all remaining siblings before applying the moved row's position.
 */
export function positionForDrop(siblings: readonly TaskView[], index: number): DropPosition {
  if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length)
    throw new TypeError("Invalid drop index.");
  const before = siblings[index - 1]?.position;
  const after = siblings[index]?.position;
  const between = positionBetween(before, after);
  const cramped = siblings.some(
    (task, at) =>
      !Number.isFinite(task.position) ||
      (at > 0 && (task.position as number) - (siblings[at - 1]?.position as number) < 1e-6),
  );
  if (
    !cramped &&
    between.position > (before ?? -Infinity) &&
    between.position < (after ?? Infinity)
  )
    return { position: between.position };
  const renumber = siblings.map((task, at) => ({ url: task.url, position: at + 1 }));
  return {
    position: positionBetween(renumber[index - 1]?.position, renumber[index]?.position).position,
    renumber,
  };
}

function move(
  siblings: readonly TaskView[],
  url: string,
  direction: -1 | 1,
): DropPosition | undefined {
  const index = siblings.findIndex((task) => task.url === url);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= siblings.length) return undefined;
  return positionForDrop(
    siblings.filter((task) => task.url !== url),
    destination,
  );
}

/** Undefined means the row is missing or is already at the corresponding edge. */
export function moveUp(siblings: readonly TaskView[], url: string): DropPosition | undefined {
  return move(siblings, url, -1);
}

export function moveDown(siblings: readonly TaskView[], url: string): DropPosition | undefined {
  return move(siblings, url, 1);
}
