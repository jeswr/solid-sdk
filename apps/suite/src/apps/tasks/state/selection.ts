// AUTHORED-BY Codex GPT-6.1-Sol
export type SelectionAction =
  | { type: "toggle"; url: string }
  | { type: "clear" }
  | { type: "prune"; visible: readonly string[] }
  /** Cmd/Ctrl+A: every visible row joins the selection. */
  | { type: "add"; urls: readonly string[] }
  /** Shift+↑/↓: `base` plus the visible rows between `anchor` and `to`, inclusive. */
  | {
      type: "range";
      base: readonly string[];
      visible: readonly string[];
      anchor: string;
      to: string;
    };
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
  if (action.type === "add") {
    if (action.urls.every((url) => state.has(url))) return state;
    return new Set([...state, ...action.urls]);
  }
  if (action.type === "range") {
    const from = action.visible.indexOf(action.anchor);
    const to = action.visible.indexOf(action.to);
    if (from < 0 || to < 0) return state;
    return new Set([
      ...action.base,
      ...action.visible.slice(Math.min(from, to), Math.max(from, to) + 1),
    ]);
  }
  const next = new Set(state);
  if (next.has(action.url)) next.delete(action.url);
  else next.add(action.url);
  return next;
}
