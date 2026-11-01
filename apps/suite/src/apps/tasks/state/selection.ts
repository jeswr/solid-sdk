// AUTHORED-BY Codex GPT-6.1-Sol
export type SelectionAction = { type: "toggle"; url: string } | { type: "clear" };
/** URL identity survives grouping and order changes. Each focus owner has its own selection. */
export function selectionReducer(
  state: ReadonlySet<string>,
  action: SelectionAction,
): ReadonlySet<string> {
  if (action.type === "clear") return new Set();
  const next = new Set(state);
  if (next.has(action.url)) next.delete(action.url);
  else next.add(action.url);
  return next;
}
