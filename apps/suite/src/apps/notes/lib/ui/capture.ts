// AUTHORED-BY Codex GPT-6.1-Sol
import { type ChecklistItem, parseQuickCapture } from "../capture";

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );
}
export function taskListHtml(items: readonly ChecklistItem[]): string {
  if (!items.length) return "";
  return `<ul data-type="taskList">${items.map((item) => `<li data-type="taskItem" data-checked="${item.checked}"><label><input type="checkbox"${item.checked ? ' checked="checked"' : ""}><span></span></label><div><p>${escapeHtml(item.text)}</p></div></li>`).join("")}</ul>`;
}
export function captureToNote(title: string, text: string, items?: readonly ChecklistItem[]) {
  if (!title.trim() && !text.trim() && !items?.some((item) => item.text.trim())) return undefined;
  if (items)
    return { title: title.trim(), body: taskListHtml(items.filter((item) => item.text.trim())) };
  const parsed = parseQuickCapture(title.trim() ? `${title}\n${text}` : text);
  return {
    title: parsed.title,
    body:
      parsed.body
        .split("\n")
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("") + taskListHtml(parsed.items),
  };
}
