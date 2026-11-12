// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useSyncExternalStore } from "react";
import type { UndoItem, UndoStack } from "./undo.js";

const empty: ReadonlyArray<UndoItem> = Object.freeze([]);
const serverSnapshot = () => empty;
/** The caller owns the stack and clears it on account/session replacement. */
export function useUndoStack(stack: UndoStack): ReadonlyArray<UndoItem> {
  return useSyncExternalStore(stack.subscribe, stack.entries, serverSnapshot);
}
