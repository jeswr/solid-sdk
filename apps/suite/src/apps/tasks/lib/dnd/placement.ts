// AUTHORED-BY Claude Opus 5.5
import type { DropContainer, Placement } from "./types";

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacementInput {
  /** The over row or card. */
  readonly over: Rect;
  /** Pointer/touch drags: the current pointer position. Keyboard drags: undefined. */
  readonly pointer?: { readonly x: number; readonly y: number } | undefined;
  /** Whether the over row sits below the dragged row's origin. */
  readonly movingDown: boolean;
  /** Whether the over row shares the dragged row's original container. */
  readonly sameContainer: boolean;
  /** Rows nest on their right half (06-tasks §4.4); board cards never do. */
  readonly allowChild: boolean;
}

/**
 * Pointer drags read the pointer against the row's halves. Keyboard drags jump
 * row by row (sortableKeyboardCoordinates), so geometry is ambiguous; the
 * direction decides instead: within the original list, moving down lands
 * after the row and moving up before it (array-move semantics); entering
 * another list from above lands before its rows, from below after them.
 */
export function placementFor(input: PlacementInput): Placement {
  const { over, pointer } = input;
  if (!pointer) return input.movingDown === input.sameContainer ? "after" : "before";
  if (input.allowChild && pointer.x > over.left + over.width / 2) return "child";
  return pointer.y < over.top + over.height / 2 ? "before" : "after";
}

/** Prefer the most specific droppable under the pointer: a row over the section around it. */
export function dropPriority(kind: unknown): number {
  return kind === "task" ? 0 : 1;
}

/** Whether two rows render in the same list (section or day group). */
export function sameContainer(a: DropContainer, b: DropContainer): boolean {
  if (a.kind === "section")
    return (
      b.kind === "section" &&
      a.projectUrl === b.projectUrl &&
      a.sectionId === b.sectionId &&
      a.lane?.group === b.lane?.group &&
      a.lane?.value === b.lane?.value
    );
  return b.kind === "day" && a.dayKey === b.dayKey;
}
