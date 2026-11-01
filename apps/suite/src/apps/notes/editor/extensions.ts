// AUTHORED-BY Codex GPT-6.1-Sol
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import type { Attribute } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { validLink } from "../../docs/lib/editor/logic";

// Pasted rel attributes cannot weaken the link policy.
const SafeStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.name === "link"
        ? extension.extend({
            addAttributes(this: { parent: (() => Record<string, Attribute>) | undefined }) {
              return {
                ...this.parent?.(),
                rel: {
                  default: "noopener noreferrer",
                  parseHTML: () => "noopener noreferrer",
                  renderHTML: () => ({ rel: "noopener noreferrer" }),
                },
              };
            },
          })
        : extension,
    );
  },
});
export function notesExtensions() {
  return [
    SafeStarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      blockquote: false,
      link: {
        openOnClick: false,
        isAllowedUri: (url) => validLink(url) !== null,
        HTMLAttributes: { rel: "noopener noreferrer", target: null },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "Note" }),
  ];
}
