// AUTHORED-BY Claude Opus 5.5
"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  type KeyboardEventHandler,
  type PointerEventHandler,
  type TouchEventHandler,
  useCallback,
} from "react";
import type { DropContainer } from "../../lib/dnd/types";
import type { TaskView } from "../../lib/views/types";
import { type DragData, type DropData, useDropHint } from "./tasks-dnd";

/**
 * A task row or board card as both draggable and drop target. Fine pointers
 * and the keyboard start from the handle; touch long-presses the whole item.
 * Without a container (label/completed views) the item is inert.
 */
export function useTaskDrag(
  task: TaskView,
  container: DropContainer | undefined,
  { disabled = false, allowChild = false }: { disabled?: boolean; allowChild?: boolean } = {},
) {
  const id = `task:${task.url}`;
  const drag = useDraggable({
    id,
    data: container ? ({ kind: "task", task, container } satisfies DragData) : {},
    disabled: disabled || !container,
  });
  const drop = useDroppable({
    id,
    data: container
      ? ({ kind: "task", url: task.url, container, allowChild } satisfies DropData)
      : {},
    disabled: !container,
  });
  const hint = useDropHint(id);
  const { setNodeRef: setDragNode } = drag;
  const { setNodeRef: setDropNode } = drop;
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragNode(node);
      setDropNode(node);
    },
    [setDragNode, setDropNode],
  );
  const enabled = Boolean(container) && !disabled;
  // dnd-kit types its activator map loosely; these are the three sensors' React events.
  const listeners = drag.listeners as
    | {
        onPointerDown?: PointerEventHandler;
        onTouchStart?: TouchEventHandler;
        onKeyDown?: KeyboardEventHandler;
      }
    | undefined;
  return {
    enabled,
    ref,
    dragging: drag.isDragging,
    hint,
    /** Spread on the handle button (pointer + keyboard activators, ARIA). */
    handle: enabled
      ? {
          ref: drag.setActivatorNodeRef,
          ...drag.attributes,
          onPointerDown: listeners?.onPointerDown,
          onKeyDown: listeners?.onKeyDown,
        }
      : undefined,
    /** Spread on the item itself: touch long-press anywhere on it. */
    touch: enabled ? { onTouchStart: listeners?.onTouchStart } : undefined,
    /** Board cards: fine pointers may also grab the whole card (distance-activated). */
    pointer: enabled ? { onPointerDown: listeners?.onPointerDown } : undefined,
  };
}

/** A section header/add row, Upcoming day header/strip cell, sidebar project or board column. */
export function useDropTarget(id: string, data: DropData | undefined) {
  const drop = useDroppable({ id, data: data ?? {}, disabled: !data });
  const hint = useDropHint(id);
  return { ref: drop.setNodeRef, over: hint !== undefined };
}
