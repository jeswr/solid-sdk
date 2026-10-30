// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChecklistItem } from "../capture";
import { array, record, requireValue, text } from "./validation";

function checklist(value: readonly ChecklistItem[]): void {
  for (const item of array(value)) {
    const fields = record(item, ["text", "checked"]);
    text(fields.text);
    requireValue(typeof fields.checked === "boolean");
  }
}
function index(value: number, length: number): void {
  requireValue(Number.isSafeInteger(value) && value >= 0 && value < length, "invalid-index");
}

/** Indices are zero-based; validate all items, including those not changed. */
export function toggleChecklistItem(items: readonly ChecklistItem[], at: number): ChecklistItem[] {
  checklist(items);
  index(at, items.length);
  return items.map((item, i) => (i === at ? { ...item, checked: !item.checked } : item));
}

/** `to` is the item's final index after removal and insertion. */
export function reorderChecklistItems(
  items: readonly ChecklistItem[],
  from: number,
  to: number,
): ChecklistItem[] {
  checklist(items);
  index(from, items.length);
  index(to, items.length);
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item as ChecklistItem);
  return result;
}

/** Stable partition: retain relative order within unchecked and checked groups. */
export function moveCheckedToBottom(items: readonly ChecklistItem[]): ChecklistItem[] {
  checklist(items);
  return [...items.filter((item) => !item.checked), ...items.filter((item) => item.checked)];
}

export function uncheckAll(items: readonly ChecklistItem[]): ChecklistItem[] {
  checklist(items);
  return items.map((item) => (item.checked ? { ...item, checked: false } : item));
}
