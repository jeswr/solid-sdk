// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { TimelineGroup } from "../library/timeline";
import { isRecord, isText, requireAlbum } from "./error";

/** Structurally accepts groupTimeline output when items are photo IDs. */
export type SelectionGroup = Readonly<Omit<TimelineGroup<string>, "items">> & {
  readonly items: readonly string[];
};

export interface PhotoSelection {
  readonly selected: readonly string[];
  readonly anchor: string | null;
}

export type SelectionAction =
  | { readonly type: "toggle"; readonly id: string }
  | { readonly type: "range"; readonly id: string }
  | { readonly type: "select-all" }
  | { readonly type: "clear" };

/**
 * Pure selection reducer over the currently displayed, filtered timeline order.
 * Toggle establishes an anchor; range replaces selection inclusively, keeping that anchor.
 * Clear/select-all reset the anchor. Stale IDs and ambiguous duplicate groups/items throw.
 * Selected IDs are always returned in display order; inputs are never mutated.
 */
export function selectionReducer(
  state: PhotoSelection,
  action: SelectionAction,
  groups: readonly SelectionGroup[],
): PhotoSelection {
  requireAlbum(Array.isArray(groups), "invalid-selection");
  const groupKeys = new Set<string>();
  const ids: string[] = [];
  const visible = new Set<string>();
  for (const group of groups) {
    requireAlbum(isRecord(group) && isText(group.key), "invalid-selection");
    requireAlbum(!groupKeys.has(group.key) && Array.isArray(group.items), "invalid-selection");
    groupKeys.add(group.key);
    for (const id of group.items) {
      requireAlbum(isText(id) && !visible.has(id), "invalid-selection");
      visible.add(id);
      ids.push(id);
    }
  }
  requireAlbum(isRecord(state) && Array.isArray(state.selected), "invalid-selection");
  const selected = new Set<string>();
  for (const id of state.selected) {
    requireAlbum(visible.has(id) && !selected.has(id), "invalid-selection");
    selected.add(id);
  }
  requireAlbum(state.anchor === null || visible.has(state.anchor), "invalid-selection");
  requireAlbum(isRecord(action), "invalid-selection");
  switch (action.type) {
    case "clear":
      return { selected: [], anchor: null };
    case "select-all":
      return { selected: ids, anchor: null };
    case "toggle": {
      requireAlbum(visible.has(action.id), "invalid-selection");
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { selected: ids.filter((id) => selected.has(id)), anchor: action.id };
    }
    case "range": {
      requireAlbum(visible.has(action.id), "invalid-selection");
      const anchor = state.anchor ?? action.id;
      const start = ids.indexOf(anchor);
      const end = ids.indexOf(action.id);
      return { selected: ids.slice(Math.min(start, end), Math.max(start, end) + 1), anchor };
    }
    default:
      requireAlbum(false, "invalid-selection");
  }
}
