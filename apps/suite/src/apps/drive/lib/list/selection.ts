// AUTHORED-BY Codex GPT-6.1-Sol
import { isRecord, isText, requireValid, validateIds } from "./validation";

export interface SelectionState {
  readonly selected: readonly string[];
  readonly anchor: string | null;
  readonly focus: string | null;
}

/** UI adapters map Ctrl/Cmd+click to toggle and Shift gestures to range/extend. */
export type SelectionAction =
  | { readonly type: "click"; readonly id: string }
  | { readonly type: "toggle"; readonly id: string }
  | { readonly type: "range"; readonly id: string; readonly additive?: boolean }
  | { readonly type: "keyboard"; readonly id: string; readonly extend: boolean }
  | { readonly type: "select-all" | "clear" };

export function createSelection(): SelectionState {
  return { selected: [], anchor: null, focus: null };
}

/**
 * IDs, not indices, preserve selection across sort and view changes. Pass the current
 * visible order on every action; dispatch clear on navigation. Hidden selections are
 * retained by toggles/focus, but select-all replaces them with exactly visible IDs.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
  visibleIds: readonly string[],
): SelectionState {
  requireValid(isRecord(state), "invalid-selection");
  validateIds(state.selected, "invalid-selection");
  requireValid(state.anchor === null || isText(state.anchor), "invalid-selection");
  requireValid(state.focus === null || isText(state.focus), "invalid-selection");
  validateIds(visibleIds, "invalid-selection");
  requireValid(isRecord(action), "invalid-action");
  if (action.type === "clear") return createSelection();
  if (action.type === "select-all") {
    const first = visibleIds[0] ?? null;
    return { selected: [...visibleIds], anchor: first, focus: first };
  }
  requireValid(["click", "toggle", "range", "keyboard"].includes(action.type), "invalid-action");
  // Narrow the two non-target actions after runtime validation above.
  requireValid("id" in action && isText(action.id), "invalid-action");
  const id = action.id;
  requireValid(visibleIds.includes(id), "unknown-id");
  if (action.type === "click") return { selected: [id], anchor: id, focus: id };
  if (action.type === "toggle") {
    const selected = state.selected.includes(id)
      ? state.selected.filter((item) => item !== id)
      : [...state.selected, id];
    return { selected, anchor: id, focus: id };
  }
  let additive = false;
  if (action.type === "keyboard") {
    requireValid(typeof action.extend === "boolean", "invalid-action");
    if (!action.extend) return { selected: [...state.selected], anchor: id, focus: id };
  } else {
    requireValid(
      action.additive === undefined || typeof action.additive === "boolean",
      "invalid-action",
    );
    additive = action.additive === true;
  }
  const anchor = state.anchor ?? state.focus ?? id;
  const start = visibleIds.indexOf(anchor);
  requireValid(start !== -1, "unknown-id");
  const end = visibleIds.indexOf(id);
  const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
  const selected = additive ? [...new Set([...state.selected, ...range])] : range;
  return { selected, anchor, focus: id };
}
