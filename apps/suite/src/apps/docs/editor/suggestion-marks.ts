// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Mark } from "@tiptap/react";

export function suggestionColour(author: string): string {
  let hash = 0;
  for (const char of author) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  // Stable author colours use the suite's theme-aware accent palette.
  const colours = ["var(--primary)", "var(--success)", "var(--info)", "var(--destructive)"];
  return colours[Math.abs(hash) % colours.length] as string;
}
function suggestionMark(name: string, tag: string) {
  return Mark.create({
    name,
    inclusive: false,
    excludes: name,
    keepOnSplit: false,
    addAttributes() {
      return Object.fromEntries(
        ["id", "author", "created"].map((key) => [
          key,
          {
            default: "",
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(`data-suggestion-${key}`) ?? "",
            renderHTML: (attrs: Record<string, string>) => ({
              [`data-suggestion-${key}`]: attrs[key],
            }),
          },
        ]),
      );
    },
    parseHTML: () => [{ tag: `${tag}[data-suggestion-id]`, priority: 1000 }],
    renderHTML({ HTMLAttributes, mark }) {
      return [
        tag,
        {
          ...HTMLAttributes,
          class: `docs-suggestion-${tag}`,
          style: `color: ${suggestionColour(String(mark.attrs.author ?? ""))}`,
        },
        0,
      ];
    },
  });
}
export const SuggestionInsert = suggestionMark("suggestionInsert", "ins");
export const SuggestionDelete = suggestionMark("suggestionDelete", "del");
