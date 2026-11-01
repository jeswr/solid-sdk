// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type KeyboardEvent, useCallback } from "react";
import type { PriorityLevel } from "../lib/views/types";

export type TasksCommand =
  | { type: "focus" | "reorder" | "extend"; direction: -1 | 1 }
  | { type: "priority"; level: PriorityLevel }
  | { type: "reschedule"; days: 0 | 1 | 7 }
  | {
      type:
        | "open"
        | "select"
        | "clear"
        | "complete"
        | "edit"
        | "due"
        | "labels"
        | "repeat"
        | "delete"
        | "menu"
        | "selectAll";
    };
interface KeyInput {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  editable?: boolean;
}
/** The Tasks scope deliberately reserves Space/x for selection. */
export function tasksCommand(key: KeyInput, hasSelection = false): TasksCommand | undefined {
  if (key.editable || key.isComposing) return;
  if (key.ctrlKey || key.metaKey)
    return !key.altKey && !key.shiftKey && key.key.toLowerCase() === "a"
      ? { type: "selectAll" }
      : undefined;
  if (key.altKey) {
    if (!key.shiftKey && (key.key === "ArrowUp" || key.key === "ArrowDown"))
      return { type: "reorder", direction: key.key === "ArrowUp" ? -1 : 1 };
    return;
  }
  if (key.shiftKey) {
    if (key.key === "ArrowUp" || key.key === "ArrowDown")
      return { type: "extend", direction: key.key === "ArrowUp" ? -1 : 1 };
    return key.key === "F10" ? { type: "menu" } : undefined;
  }
  if (["ArrowDown", "j", "ArrowUp", "k"].includes(key.key))
    return { type: "focus", direction: key.key === "ArrowDown" || key.key === "j" ? 1 : -1 };
  if (/^[1-4]$/.test(key.key)) return { type: "priority", level: Number(key.key) as PriorityLevel };
  if (key.key === "t" || key.key === "m" || key.key === "w")
    return { type: "reschedule", days: key.key === "t" ? 0 : key.key === "m" ? 1 : 7 };
  switch (key.key) {
    case "Enter":
      return { type: "open" };
    case " ":
    case "x":
      return { type: "select" };
    case "Escape":
      return { type: "clear" };
    case "e":
      return { type: hasSelection ? "complete" : "edit" };
    case "d":
      return { type: "due" };
    case "l":
      return { type: "labels" };
    case "r":
      return { type: "repeat" };
    case "Delete":
    case "Backspace":
      return { type: "delete" };
  }
}
/** View-scope §8 keys: `b` opens the board, Shift+L the list. */
export function viewModeShortcut(key: KeyInput): "board" | "list" | undefined {
  if (key.editable || key.isComposing || key.ctrlKey || key.metaKey || key.altKey) return;
  if (!key.shiftKey && key.key === "b") return "board";
  if (key.shiftKey && (key.key === "L" || key.key === "l")) return "list";
}
export function useTasksShortcuts(hasSelection: boolean, execute: (command: TasksCommand) => void) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // Native controls and portaled editors retain their own keyboard interaction.
      if (event.target !== event.currentTarget) return;
      const command = tasksCommand(
        {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
          editable: event.currentTarget.matches(
            'input, textarea, select, [contenteditable="true"]',
          ),
        },
        hasSelection,
      );
      if (!command) return;
      event.preventDefault();
      execute(command);
    },
    [execute, hasSelection],
  );
}
