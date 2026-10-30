// AUTHORED-BY Codex
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Plugin } from "@tiptap/pm/state";
import { type Attribute, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Doc } from "yjs";
import { codeWhitespaceTextblocks, compatibleCodeExtensions } from "../lib/editor/code-mark";
import { normaliseDestination, normaliseImageDestination } from "../lib/editor/destination";
import { normaliseHtmlLists } from "../lib/editor/html-lists";
import { validLink } from "../lib/editor/logic";
import { normaliseTableSpan } from "../lib/editor/table-spans";
import { FindDecorations } from "./find-plugin";
import { protectiveLinkRel } from "./link-rel";
import { privateImage } from "./private-image";

const SafeStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.name === "link"
        ? extension.extend({
            addAttributes(this: { parent: (() => Record<string, Attribute>) | undefined }) {
              const attrs = this.parent?.() ?? {};
              return {
                ...attrs,
                rel: {
                  ...attrs.rel,
                  parseHTML: (element: HTMLElement) =>
                    protectiveLinkRel(element.getAttribute("rel")),
                  renderHTML: (attrs: Record<string, unknown>) => ({
                    rel: protectiveLinkRel(attrs.rel),
                  }),
                },
              };
            },
          })
        : extension,
    );
  },
});

const PasteDestinations = Extension.create({
  name: "docsPasteDestinations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html) {
            // A template preserves clipboard fragments such as table rows and
            // keeps pasted images inert until the editor's node view handles them.
            const fragment = document.createElement("template");
            fragment.innerHTML = html;
            normaliseHtmlLists(fragment.content);
            for (const element of fragment.content.querySelectorAll("a[href], img[src]")) {
              const key = element.tagName === "A" ? "href" : "src";
              const url = element.getAttribute(key) as string;
              const destination =
                key === "src" ? normaliseImageDestination(url) : normaliseDestination(url);
              if (destination) element.setAttribute(key, destination);
              else element.removeAttribute(key);
            }
            return fragment.innerHTML;
          },
        },
      }),
    ];
  },
});

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
const boundedTableSpans = {
  addAttributes(this: { parent: (() => Record<string, Attribute>) | undefined }) {
    const attrs = this.parent?.() ?? {};
    return {
      ...attrs,
      ...Object.fromEntries(
        ["colspan", "rowspan"].map((key) => [
          key,
          {
            ...attrs[key],
            parseHTML: (element: HTMLElement) => normaliseTableSpan(element.getAttribute(key)) ?? 1,
          },
        ]),
      ),
    };
  },
};

const AccessibleTaskItem = TaskItem.extend({
  addNodeView() {
    const create = this.parent?.();
    if (!create) return null;
    return (props) => {
      const view = create(props);
      const checkbox = (view.dom as HTMLElement).querySelector<HTMLInputElement>(
        ':scope > label > input[type="checkbox"]',
      );
      const change = (event: Event) => {
        if (
          !checkbox ||
          checkbox.ownerDocument.activeElement !== checkbox ||
          !props.editor.isEditable
        )
          return;
        // The inherited change handler calls focus(), asynchronously moving
        // keyboard users back to the stale text caret. Update the live task
        // without scheduling editor focus when the checkbox owns focus.
        event.stopImmediatePropagation();
        props.editor.commands.command(({ tr }) => {
          const position = props.getPos();
          if (typeof position !== "number") return false;
          const node = tr.doc.nodeAt(position);
          if (node?.type !== props.node.type) return false;
          tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: checkbox.checked });
          return true;
        });
      };
      checkbox?.addEventListener("change", change, true);
      return {
        ...view,
        destroy: () => {
          checkbox?.removeEventListener("change", change, true);
          view.destroy?.();
        },
        // Controls own their keyboard events. Let native checkbox navigation and
        // activation run without editing the stale ProseMirror text selection.
        stopEvent: (event) =>
          (event.target instanceof HTMLInputElement && event.target.type === "checkbox") ||
          (view.stopEvent?.(event) ?? false),
      };
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        view(view) {
          const sync = () => {
            for (const checkbox of view.dom.querySelectorAll<HTMLInputElement>(
              'li[data-checked] > label > input[type="checkbox"]',
            ))
              if (checkbox.disabled === view.editable) checkbox.disabled = !view.editable;
          };
          sync();
          // Permission changes also update the view when setEditable suppresses
          // editor events. New and nested task node views share this invariant.
          return { update: sync };
        },
      }),
    ];
  },
});

export function baseExtensions(fetchImpl: typeof fetch) {
  return [
    SafeStarterKit.configure({
      code: false,
      paragraph: false,
      undoRedo: false,
      heading: false,
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
        isAllowedUri: (url) => validLink(url) !== null,
      },
    }),
    ...compatibleCodeExtensions,
    ...codeWhitespaceTextblocks,
    TableKit.configure({
      table: { resizable: true, cellMinWidth: 32 },
      tableCell: false,
      tableHeader: false,
    }),
    TableCell.extend(boundedTableSpans),
    TableHeader.extend(boundedTableSpans),
    TaskList,
    AccessibleTaskItem.configure({
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
    PasteDestinations,
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
