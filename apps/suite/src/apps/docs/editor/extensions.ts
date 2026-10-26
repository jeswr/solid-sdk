// AUTHORED-BY Codex
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Doc } from "yjs";
import { validLink } from "../lib/editor/logic";
import { FindDecorations } from "./find-plugin";
import { privateImage } from "./private-image";

const EditorKeys = Extension.create({
  name: "docsKeys",
  addKeyboardShortcuts() {
    return {
      "Mod-e": () => this.editor.commands.toggleCode(),
      "Mod-Shift-h": () => this.editor.commands.toggleHighlight(),
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
      "Mod-\\": () => this.editor.chain().unsetAllMarks().clearNodes().run(),
      Tab: () => {
        const e = this.editor;
        if (e.isActive("table")) return e.commands.goToNextCell();
        if (e.isActive("taskItem")) {
          if (e.state.selection.$from.depth >= 7) return true;
          return e.commands.sinkListItem("taskItem");
        }
        return e.commands.sinkListItem("listItem");
      },
      "Shift-Tab": () =>
        this.editor.isActive("table")
          ? this.editor.commands.goToPreviousCell()
          : this.editor.commands.liftListItem(
              this.editor.isActive("taskItem") ? "taskItem" : "listItem",
            ),
    };
  },
});
export function baseExtensions(fetchImpl: typeof fetch) {
  return [
    StarterKit.configure({
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
        isAllowedUri: (url) => validLink(url) !== null,
      },
    }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 32 } }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => node.textContent || "Empty checklist item" },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight,
    Subscript,
    Superscript,
    privateImage(fetchImpl),
    Placeholder.configure({ placeholder: "Start writing, or type / for ideas…" }),
    CharacterCount,
    EditorKeys,
    FindDecorations,
  ];
}
export function editorExtensions(doc: Doc, fetchImpl: typeof fetch) {
  return [
    ...baseExtensions(fetchImpl),
    Collaboration.configure({ document: doc, field: "prosemirror" }),
  ];
}
