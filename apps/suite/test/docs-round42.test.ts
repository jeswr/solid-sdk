// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, generateHTML, getSchema } from "@tiptap/react";
import { Document, Packer, Paragraph } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { importHtml } from "../src/apps/docs/lib/convert/schema";

const extensions = baseExtensions(vi.fn(() => new Promise<Response>(() => {})));
const schema = getSchema(extensions);
const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

it.each([
  "Title",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Heading 4",
  "Heading 5",
  "Heading 6",
  "Quote",
  "Intense Quote",
  "Code",
  "Horizontal Rule",
  "Suite Code",
  "heading 1",
  "quote",
])("round42 DOCX list mappings take precedence over preset %s styles", async (style) => {
  const id = style === "Suite Code" ? "Code" : "Styled";
  const zip = await openArrayBuffer(
    await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph("Seed")] }] })),
  );
  zip.write(
    "word/styles.xml",
    `<w:styles ${ns}><w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${style}"/></w:style><w:style w:type="paragraph" w:styleId="ListContinuation${id}"><w:name w:val="List Continuation ${style}"/><w:basedOn w:val="${id}"/></w:style></w:styles>`,
  );
  const p = (text: string, props = "") =>
    `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const numbered = `<w:pStyle w:val="${id}"/><w:numPr><w:numId w:val="5"/></w:numPr>`;
  const continuation = `<w:pStyle w:val="ListContinuation${id}"/><w:ind w:left="720"/>`;
  const standalone = `<w:pStyle w:val="${id}"/><w:ind w:left="720"/>`;
  zip.write(
    "word/document.xml",
    `<w:document ${ns}><w:body>${p("First", numbered)}${p("Second", numbered)}${p("Continued", continuation)}${p("Standalone", standalone)}${p("See section 8 above.")}</w:body></w:document>`,
  );
  zip.write(
    "word/numbering.xml",
    `<w:numbering ${ns}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="7"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  );
  const result = importHtml(
    (await importDocx(await zip.toArrayBuffer(), { uploadImage: vi.fn(), progress: vi.fn() })).html,
  );
  const list = result.json.content?.[0];
  expect(list).toMatchObject({ type: "orderedList", attrs: { start: 7 } });
  expect(list?.content).toHaveLength(2);
  // A rule styled as a horizontal rule has no text in Mammoth's preset mapping.
  if (style !== "Horizontal Rule")
    expect(list?.content?.map((item) => schema.nodeFromJSON(item).textContent)).toEqual([
      "First",
      style === "Code" ? "Second\nContinued" : "SecondContinued",
    ]);
  const block =
    style === "Title" || style.toLowerCase().startsWith("heading")
      ? "heading"
      : style.toLowerCase().includes("quote")
        ? "blockquote"
        : style.includes("Code")
          ? "codeBlock"
          : "horizontalRule";
  expect(list?.content?.[0]?.content?.some((node) => node.type === block)).toBe(true);
  expect(list?.content?.[1]?.content?.filter((node) => node.type === block)).toHaveLength(
    style === "Code" ? 1 : 2,
  );
  // Even matching styles and indentation cannot prove continuation intent.
  expect(result.json.content?.[1]?.type).toBe(block);
  expect(result.json.content?.at(-1)?.content?.[0]?.text).toBe("See section 8 above.");
  expect(importHtml(generateHTML(result.json, extensions)).json).toEqual(result.json);
});

it.each([
  "ol",
  "ul",
  "task",
])("round42 pasted %s lists normalize every leading block and nested item", (kind) => {
  const opening =
    kind === "ol" ? 'ol start="7"' : kind === "task" ? 'ul data-type="taskList"' : "ul";
  const closing = kind === "ol" ? "ol" : "ul";
  const item = kind === "task" ? 'li data-type="taskItem" data-checked="true"' : "li";
  for (const block of [
    "<h2>First</h2>",
    "<blockquote><p>First</p></blockquote>",
    "<pre>First</pre>",
    "<ul><li><p>First</p></li></ul>",
    "<table><tr><td>First</td></tr></table>",
    "<hr>",
    '<p><img src="https://example.org/image.png"></p>',
  ]) {
    const html = `<${opening}><${item}> \n${block}<${opening}><${item}><h2>Nested</h2></li></${closing}></li><${item}><h2>Second</h2></li></${closing}>`;
    const editor = new Editor({ extensions, content: "" });
    try {
      editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
      const expected = importHtml(html).json;
      expect(editor.getJSON()).toEqual({
        ...expected,
        content: [...(expected.content ?? []), { type: "paragraph", attrs: { textAlign: null } }],
      });
      expect(editor.getJSON().content?.[0]?.content).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  }
});

it.each([
  ["Tab", false],
  ["Tab", true],
  ["Enter", false],
  ["Backspace", false],
  ["e", false],
])("round42 checkbox %s (shift %s) bypasses all editing keymaps", (key, shiftKey) => {
  const update = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions,
    editorProps: { handleScrollToSelection: () => true },
    content:
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>First</p></li><li data-type="taskItem" data-checked="false"><p>Second</p></li></ul>',
    onUpdate: update,
  });
  try {
    editor.commands.setTextSelection(3);
    update.mockClear();
    const before = editor.getJSON();
    const inputs = [
      ...editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    inputs[1]?.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      ctrlKey: key === "e",
      bubbles: true,
      cancelable: true,
    });
    inputs[1]?.dispatchEvent(event);
    expect(editor.getJSON()).toEqual(before);
    expect(update).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(inputs.map((input) => input.checked)).toEqual([true, false]);
    inputs[1]?.click();
    expect(editor.getJSON().content?.[0]?.content?.[1]).toMatchObject({ attrs: { checked: true } });
    // Text editing still uses the list keymaps once focus leaves the control.
    editor.view.dom.focus();
    const lift = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(lift);
    expect(lift.defaultPrevented).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
  } finally {
    editor.destroy();
    host.remove();
  }
});
