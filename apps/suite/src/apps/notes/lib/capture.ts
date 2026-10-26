// AUTHORED-BY Codex GPT-6.1-Sol
import { assertText, NotesError } from "./validation";

export interface ChecklistItem {
  readonly text: string;
  readonly checked: boolean;
}
export interface QuickCapture {
  readonly title: string;
  readonly body: string;
  readonly items: readonly ChecklistItem[];
}

/**
 * Plain text only. First line is the title unless it is a checklist line.
 * Extract exact [ ], [x], - [ ], - [x] markers followed by a space and nonempty
 * text. Other lines retain their whitespace in body; only CRLF is normalised.
 * Reject unsupported checkbox variants rather than converting them to prose.
 */
export function parseQuickCapture(text: string): QuickCapture {
  assertText(text);
  const normalised = text.replace(/\r\n/g, "\n");
  if (normalised.includes("\r") || normalised.trim().length === 0) {
    throw new NotesError("unsupported-capture", "Capture must contain text and use LF or CRLF");
  }
  let title = "";
  const body: string[] = [];
  const items: ChecklistItem[] = [];
  for (const [index, line] of normalised.split("\n").entries()) {
    const match = /^(?:- )?\[([ x])\] (.*)$/.exec(line);
    if (match) {
      const itemText = match[2] as string;
      if (itemText.trim().length === 0) {
        throw new NotesError("unsupported-capture", "Checklist items must contain text");
      }
      items.push({ text: itemText, checked: match[1] === "x" });
    } else {
      // Reserve checkbox-like starts, including malformed/unclosed markers and nesting.
      if (/^\s*(?:[-*+]\s+)*\[(?:\s|[xX](?:\]|\s|$))/.test(line)) {
        throw new NotesError("unsupported-capture", "Unsupported checklist syntax");
      }
      if (index === 0) title = line;
      else body.push(line);
    }
  }
  return { title, body: body.join("\n"), items };
}
