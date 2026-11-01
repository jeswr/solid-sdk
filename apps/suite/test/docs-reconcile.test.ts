// @vitest-environment jsdom
// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { Editor } from "@tiptap/react";
import { expect, it } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import { createDemoPod } from "../src/lib/demo-pod/pod";

it("preserves the first-paragraph selection when identical pod content reconciles", async () => {
  const root = "https://reconcile.test/";
  const pod = createDemoPod({ root });
  const doc = new Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(doc, pod.fetch),
  });
  let provider: SolidPersistence | undefined;
  try {
    editor.commands.setContent("<p>First paragraph</p><p>Second paragraph</p>");
    const update = encodeStateAsUpdate(doc);
    await pod.fetch(`${root}updates/saved.bin`, {
      method: "PUT",
      body: new Blob([Uint8Array.from(update)]),
      headers: { "content-type": "application/octet-stream" },
    });
    editor.commands.setTextSelection(1);
    const before = editor.state.selection.toJSON();
    const beforeDoc = editor.state.doc;
    provider = new SolidPersistence({ doc, container: `${root}updates/`, fetch: pod.fetch });
    await provider.whenSynced;
    expect(editor.state.selection.toJSON()).toEqual(before);
    expect(editor.state.doc).toBe(beforeDoc);
    editor.commands.setHeading({ level: 1 });
    expect(editor.getHTML()).toBe("<h1>First paragraph</h1><p>Second paragraph</p>");
    // A later duplicate full-state update must also leave a caret at the end alone.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const end = editor.state.selection.toJSON();
    const remote = new Doc();
    applyUpdate(remote, update);
    applyUpdate(doc, encodeStateAsUpdate(remote));
    remote.destroy();
    expect(editor.state.selection.toJSON()).toEqual(end);
    editor.commands.insertContent(" checklist");
    expect(editor.getText()).toContain("Second paragraph checklist");
  } finally {
    provider?.destroy();
    editor.destroy();
    doc.destroy();
  }
});
