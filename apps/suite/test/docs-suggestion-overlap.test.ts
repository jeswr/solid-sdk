// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 5.5
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

const paragraphsOf = (editor: Editor) => {
  const paragraphs: string[] = [];
  editor.state.doc.forEach((node) => {
    paragraphs.push(node.textContent);
  });
  return paragraphs;
};

it("rejecting a suggested break keeps a split the owner made later in Editing mode", () => {
  const editor = new Editor({ extensions: baseExtensions(fetch), content: "<p>leftright</p>" });
  try {
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "bob" }));
    editor.commands.setTextSelection(5);
    editor.commands.splitBlock();
    const [suggested] = suggestions(editor.state.doc);
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }),
    );
    editor.commands.setTextSelection(3);
    editor.commands.splitBlock();
    expect(paragraphsOf(editor)).toEqual(["le", "ft", "right"]);
    expect(suggestions(editor.state.doc)).toEqual([suggested]);
    editor.view.dispatch(resolveSuggestions(editor.state, false, suggested?.id));
    expect(paragraphsOf(editor)).toEqual(["le", "ftright"]);
    expect(suggestions(editor.state.doc)).toEqual([]);
  } finally {
    editor.destroy();
  }
});

it("accepting a suggested cross-paragraph deletion keeps a split the owner made later", () => {
  const editor = new Editor({
    extensions: baseExtensions(fetch),
    content: "<p>abc</p><p>def</p><p>ghi</p>",
  });
  try {
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "bob" }));
    editor.view.dispatch(editor.state.tr.delete(3, 7));
    const [suggested] = suggestions(editor.state.doc);
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }),
    );
    editor.commands.setTextSelection(2);
    editor.commands.splitBlock();
    expect(paragraphsOf(editor)).toEqual(["a", "bc", "def", "ghi"]);
    editor.view.dispatch(resolveSuggestions(editor.state, true, suggested?.id));
    expect(paragraphsOf(editor)).toEqual(["a", "bef", "ghi"]);
  } finally {
    editor.destroy();
  }
});

it("drops a stored edge whose paragraph boundary is deleted in Editing mode", () => {
  const editor = new Editor({ extensions: baseExtensions(fetch), content: "<p>leftright</p>" });
  try {
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "bob" }));
    editor.commands.setTextSelection(5);
    editor.commands.splitBlock();
    expect(suggestions(editor.state.doc)).toHaveLength(1);
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }),
    );
    // Select across the suggested break and delete it outright.
    editor.view.dispatch(editor.state.tr.delete(4, 9));
    expect(paragraphsOf(editor)).toEqual(["lefght"]);
    expect(suggestions(editor.state.doc)).toEqual([]);
  } finally {
    editor.destroy();
  }
});

it("leaves stored edges alone when an Editing-mode edit does not move them", () => {
  const editor = new Editor({ extensions: baseExtensions(fetch), content: "<p>leftright</p>" });
  try {
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "bob" }));
    editor.commands.setTextSelection(5);
    editor.commands.splitBlock();
    const before = suggestions(editor.state.doc);
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }),
    );
    editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.content.size - 1));
    expect(paragraphsOf(editor)).toEqual(["left", "right!"]);
    expect(suggestions(editor.state.doc)).toEqual(before);
  } finally {
    editor.destroy();
  }
});
