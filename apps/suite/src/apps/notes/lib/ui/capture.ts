// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type ChecklistItem, parseQuickCapture } from "../capture";

/** Fit the document's UTF-16 title limit without splitting a visible character. */
export function captureTitle(line: string): string {
  if (line.length <= 200) return line;
  let prefix = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    line,
  )) {
    if (prefix.length + segment.length > 199) break;
    prefix += segment;
  }
  const boundaries = [...prefix.matchAll(/\s+/gu)];
  const boundary = boundaries.at(-1)?.index;
  if (boundary !== undefined && boundary > 0 && boundary >= prefix.length - 40)
    prefix = prefix.slice(0, boundary);
  return `${prefix.trimEnd()}…`;
}

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
  const derived = !title.trim() ? captureTitle(parsed.title) : parsed.title;
  return {
    title: derived,
    body:
      (!title.trim() && parsed.title ? `${parsed.title}\n${parsed.body}` : parsed.body)
        .split("\n")
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("") + taskListHtml(parsed.items),
  };
}
