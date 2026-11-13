// AUTHORED-BY Claude Opus 5.5
"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  type KeyboardEventHandler,
  type MouseEvent,
  type PointerEventHandler,
  type TouchEvent,
  type TouchEventHandler,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { DropContainer } from "../../lib/dnd/types";
import type { TaskView } from "../../lib/views/types";
import { useIssueAccess } from "../issues/use-issue-access";
import {
  type DragData,
  type DropData,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  useDropHint,
} from "./tasks-dnd";

/**
 * Touch long-press without dnd-kit, for items that cannot be dragged (label and completed views,
 * pending rows): hold still for the delay to fire, move or lift early to cancel.
 */
function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  if (!onLongPress) return undefined;
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      cancel();
      if (!touch || event.touches.length > 1) return;
      origin.current = { x: touch.clientX, y: touch.clientY };
      timer.current = setTimeout(onLongPress, LONG_PRESS_MS);
    },
    onTouchMove: (event: TouchEvent) => {
      const touch = event.touches[0];
      if (
        touch &&
        Math.hypot(touch.clientX - origin.current.x, touch.clientY - origin.current.y) >
          LONG_PRESS_SLOP
      )
        cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
}

/** A touch long-press must not open the browser's context menu (Android) over the item. */
const noTouchMenu = (event: MouseEvent) => {
  if ((event.nativeEvent as PointerEvent).pointerType === "touch") event.preventDefault();
};

/**
 * A task row or board card as both draggable and drop target. Fine pointers
 * and the keyboard start from the handle; touch long-presses the whole item.
 * Without a container (label/completed views) the item is inert.
 */
export function useTaskDrag(
  task: TaskView,
  container: DropContainer | undefined,
  {
    disabled = false,
    allowChild = false,
    onLongPress,
  }: { disabled?: boolean; allowChild?: boolean; onLongPress?: (() => void) | undefined } = {},
) {
  const { issue } = useIssueAccess(task);
  disabled ||= issue;
  const id = `task:${task.url}`;
  const drag = useDraggable({
    id,
    data: container ? ({ kind: "task", task, container, onLongPress } satisfies DragData) : {},
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
  const fallback = useLongPress(enabled ? undefined : onLongPress);
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
    /**
     * Spread on the item itself: touch long-press anywhere on it drags once it moves, and selects
     * (onLongPress) when released in place.
     */
    touch: enabled
      ? { onTouchStart: listeners?.onTouchStart, onContextMenu: noTouchMenu }
      : fallback && { ...fallback, onContextMenu: noTouchMenu },
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
