// AUTHORED-BY Codex
import { toast } from "@jeswr/suite-ui";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

/** Clipboard APIs retain rich content; browser permission failures leave the selection intact. */
export async function clipboardAction(editor: Editor, action: "cut" | "copy" | "paste") {
  try {
    if (action === "paste") {
      let html = "";
      let text = "";
      const files: File[] = [];
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read())
          for (const type of item.types) {
            if (type === "text/html" && !html) html = await (await item.getType(type)).text();
            else if (type === "text/plain" && !text) text = await (await item.getType(type)).text();
            else if (type.startsWith("image/"))
              files.push(new File([await item.getType(type)], "pasted-image", { type }));
          }
      } else text = await navigator.clipboard.readText();
      if (!html && !text && !files.length) return;
      // Route through the editor's paste handling with the clipboard's data attached, so
      // images take the same upload path as a keyboard paste instead of being dropped.
      const event = new ClipboardEvent("paste");
      Object.defineProperty(event, "clipboardData", {
        value: {
          files,
          types: [...(html ? ["text/html"] : []), ...(text ? ["text/plain"] : [])],
          getData: (type: string) =>
            type === "text/html" ? html : type === "text/plain" ? text : "",
        },
      });
      editor.commands.focus();
      if (html) editor.view.pasteHTML(html, event);
      else editor.view.pasteText(text, event);
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
