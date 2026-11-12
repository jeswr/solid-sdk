// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { expect, it } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import {
  resolveSuggestions,
  suggestionKey,
  suggestions,
} from "../src/apps/docs/lib/editor/suggestions";

it.each([
  "insertion",
  "deletion",
])("retiring an overlapping %s never moves its counterpart to an unrelated paragraph break", (first) => {
  const editor = new Editor({
    extensions: baseExtensions(fetch),
    content: "<p>leftright</p><p>untouched</p>",
  });
  try {
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "bob" }));
    editor.commands.setTextSelection(5);
    editor.commands.splitBlock();
    const insertion = suggestions(editor.state.doc)[0]?.id;
    expect(insertion).toEqual(expect.any(String));
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "alice" }),
    );
    editor.view.dispatch(editor.state.tr.delete(4, 8));
    const deletion = suggestions(editor.state.doc).find((item) => item.author === "alice")?.id;
    expect(deletion).toEqual(expect.any(String));
    editor.view.dispatch(
      resolveSuggestions(
        editor.state,
        first === "deletion",
        first === "insertion" ? insertion : deletion,
      ),
    );
    editor.view.dispatch(
      resolveSuggestions(
        editor.state,
        first === "insertion",
        first === "insertion" ? deletion : insertion,
      ),
    );
    const paragraphs: string[] = [];
    editor.state.doc.forEach((node) => {
      paragraphs.push(node.textContent);
    });
    expect(paragraphs).toEqual(["lefight", "untouched"]);
    expect(suggestions(editor.state.doc)).toEqual([]);
  } finally {
    editor.destroy();
  }
});
