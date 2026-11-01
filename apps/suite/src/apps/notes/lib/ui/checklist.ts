// AUTHORED-BY Codex GPT-6.1-Sol
import sanitizeHtml from "sanitize-html";
import type { ChecklistItem } from "../capture";
import { noteText } from "../model/text";

export function checklistItems(html: string): ChecklistItem[] {
  const rows: { text: string; checked: boolean }[] = [];
  const stack: (number | undefined)[] = [];
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag: (tag, attrs) => {
      if (tag !== "li") return;
      const index = attrs["data-type"] === "taskItem" ? rows.length : undefined;
      if (index !== undefined) rows.push({ text: "", checked: attrs["data-checked"] === "true" });
      stack.push(index);
    },
    onCloseTag: (tag) => {
      if (tag === "li") stack.pop();
    },
    textFilter: (text) => {
      const index = stack.at(-1);
      if (index !== undefined) (rows[index] as { text: string }).text += text;
      return "";
    },
  });
  return rows.map((row) => ({ ...row, text: noteText(row.text) }));
}
/** Change only the selected task's opening tag. The rest of the rich body stays byte intact. */
export function toggleChecklistItem(html: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid task index");
  let current = 0;
  let found = false;
  const result = html.replace(/<li\b[^>]*>/gi, (tag) => {
    if (!/\bdata-type\s*=\s*(["'])taskItem\1/i.test(tag) || current++ !== index) return tag;
    found = true;
    if (/\bdata-checked\s*=\s*(["'])true\1/i.test(tag))
      return tag.replace(/\bdata-checked\s*=\s*(["'])true\1/i, 'data-checked="false"');
    if (/\bdata-checked\s*=\s*(["'])[^"']*\1/i.test(tag))
      return tag.replace(/\bdata-checked\s*=\s*(["'])[^"']*\1/i, 'data-checked="true"');
    return tag.replace(/>$/, ' data-checked="true">');
  });
  if (!found) throw new RangeError("Task no longer exists");
  return result;
}
