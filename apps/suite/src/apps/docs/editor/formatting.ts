// AUTHORED-BY Codex
import type { Editor } from "@tiptap/react";

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
            indent: Math.min(8, Math.max(0, Number(node.attrs.indent) + direction)),
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
