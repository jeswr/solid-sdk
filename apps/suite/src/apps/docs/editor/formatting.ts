// AUTHORED-BY Codex
import type { Editor } from "@tiptap/react";
import { indentLevel } from "../lib/editor/styles";

export function indentDocument(editor: Editor, direction: -1 | 1) {
  const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
  if (editor.isActive(item))
    return direction === 1
      ? editor.chain().focus().sinkListItem(item).run()
      : editor.chain().focus().liftListItem(item).run();
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === "paragraph" || node.type.name === "heading")
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            indent: indentLevel(Math.min(8, (indentLevel(node.attrs.indent) ?? 0) + direction)),
          });
      });
      return true;
    })
    .run();
}

export function paragraphSpacing(editor: Editor, attrs: Record<string, string | null>) {
  editor
    .chain()
    .focus()
    .updateAttributes("paragraph", attrs)
    .updateAttributes("heading", attrs)
    .run();
}

export function clearFormatting(editor: Editor) {
  editor
    .chain()
    .focus()
    .unsetAllMarks()
    .resetAttributes("paragraph", [
      "lineHeight",
      "spaceBefore",
      "spaceAfter",
      "indent",
      "textAlign",
    ])
    .resetAttributes("heading", ["lineHeight", "spaceBefore", "spaceAfter", "indent", "textAlign"])
    .clearNodes()
    .run();
}
