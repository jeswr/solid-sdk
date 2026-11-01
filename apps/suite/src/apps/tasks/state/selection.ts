// AUTHORED-BY Codex GPT-6.1-Sol
export type SelectionAction =
  | { type: "toggle"; url: string }
  | { type: "clear" }
  | { type: "prune"; visible: readonly string[] };
/** URL identity survives grouping and order changes. Each focus owner has its own selection. */
export function selectionReducer(
  state: ReadonlySet<string>,
  action: SelectionAction,
): ReadonlySet<string> {
  if (action.type === "clear") return state.size ? new Set() : state;
  if (action.type === "prune") {
    const next = new Set([...state].filter((url) => action.visible.includes(url)));
    return next.size === state.size ? state : next;
  }
  const next = new Set(state);
  if (next.has(action.url)) next.delete(action.url);
  else next.add(action.url);
  return next;
}
