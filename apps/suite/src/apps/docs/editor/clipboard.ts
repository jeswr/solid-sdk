// AUTHORED-BY Codex
import { toast } from "@jeswr/suite-ui";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

/** Clipboard APIs retain rich content; browser permission failures leave the selection intact. */
export async function clipboardAction(editor: Editor, action: "cut" | "copy" | "paste") {
  try {
    if (action === "paste") {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/html")) {
            const html = await (await item.getType("text/html")).text();
            editor.commands.focus();
            editor.view.pasteHTML(html);
            return;
          }
          if (item.types.includes("text/plain")) {
            const text = await (await item.getType("text/plain")).text();
            editor.commands.focus();
            editor.view.pasteText(text);
            return;
          }
        }
      } else {
        const text = await navigator.clipboard.readText();
        editor.commands.focus();
        editor.view.pasteText(text);
      }
      return;
    }
    const { from, to } = editor.state.selection;
    const original = editor.state.doc;
    if (from === to) return;
    const slice = editor.state.selection.content();
    const container = document.createElement("div");
    container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([container.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } else await navigator.clipboard.writeText(text);
    // Do not cut a different selection if it changed while permission was pending.
    if (
      action === "cut" &&
      editor.state.doc === original &&
      editor.state.selection.from === from &&
      editor.state.selection.to === to
    )
      editor.chain().focus().deleteSelection().run();
  } catch {
    toast.error(`Use your keyboard shortcut to ${action}; clipboard access wasn't granted.`);
  }
}
