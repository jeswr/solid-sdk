// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { createRequire } from "node:module";
import { chipText } from "@jeswr/suite-sdk/chips";
import "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");

import { htmlChipRefs } from "@jeswr/suite-sdk/chips";
import { type AnyExtension, Editor, getSchema } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInline } from "../src/apps/chat/lib/text/inline";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml, normaliseDestinations } from "../src/apps/docs/lib/convert/schema";
import { parseDocumentHtml } from "../src/apps/docs/lib/editor/parse-html";
import { documentStatistics } from "../src/apps/docs/lib/outline";
import { notesExtensions } from "../src/apps/notes/editor/extensions";
import { ChipText, ChipTextarea, chipHref, suiteChipExtension } from "../src/components/chips";

afterEach(cleanup);

const source = vi.hoisted(() => ({
  search: async () => ({
    source: "local",
    serverSearch: false,
    results: [
      {
        id: "https://pod.example/report.pdf",
        title: "Report",
        type: "file",
        app: "drive",
        href: "/drive",
      },
    ],
  }),
}));
vi.mock("../src/shell/search/search-context", () => ({
  useOptionalShellSearchSource: () => source,
}));

const ref = { iri: "https://pod.example/report.pdf", label: "Report", kind: "file" as const };

describe("shared suite chip adapters", () => {
  it("routes real resource identifiers to each suite application", () => {
    for (const [kind, path] of [
      ["doc", "/docs/d/"],
      ["note", "/notes/n/"],
      ["sheet", "/sheets/s/"],
      ["event", "/calendar/e/"],
      ["task", "/tasks/inbox?task="],
      ["file", "/drive/p/"],
    ] as const)
      expect(chipHref({ ...ref, kind })).toContain(path);
    expect(chipHref({ ...ref, iri: "https://pod.example/folder/" })).toContain("/drive/f/");
    expect(chipHref({ ...ref, kind: "person" })).toBe(ref.iri);
    expect(chipHref({ ...ref, kind: "link" })).toBe(ref.iri);
  });
  it("renders structured text chips and parses Chat chips while keeping code literal", () => {
    render(<ChipText text={`See ${chipText(ref)} now`} />);
    expect(screen.getByRole("link", { name: "Report" }).getAttribute("href")).toContain(
      "/drive/p/",
    );
    expect(parseInline(chipText(ref))).toEqual([{ type: "chip", ref }]);
    expect(parseInline(`\`${chipText(ref)}\``)[0]?.type).toBe("code");
    expect(
      parseInline('@[Report](javascript:bad "chip:file")').some((node) => node.type === "chip"),
    ).toBe(false);
  });
  it("restores textarea focus on Escape without submitting", async () => {
    function Field() {
      const [value, setValue] = useState("");
      return (
        <ChipTextarea
          aria-label="Comment"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    render(<Field />);
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(field, { target: { value: "@", selectionStart: 1 } });
    const picker = await screen.findByRole("combobox");
    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("inserts a chosen chip through the existing controlled textarea change handler", async () => {
    function Field() {
      const [value, setValue] = useState("");
      return (
        <ChipTextarea
          aria-label="Message"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    render(<Field />);
    const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "See @", selectionStart: 5 } });
    const option = await screen.findByRole("option", { name: /Report/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(field.value).toBe(`See ${chipText(ref)} `));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(field);
  });
  it("retains chip identity and label through HTML and markdown imports", () => {
    const html = `<p>See <a href="${ref.iri}" data-chip data-chip-kind="file" data-chip-label="Report">Report</a></p>`;
    const imported = importHtml(html).json;
    expect(imported.content?.[0]?.content?.[1]).toMatchObject({ type: "chip", attrs: ref });
    expect(documentStatistics(imported).words).toBe(2);
    const note = parseDocumentHtml(html, notesExtensions(fetch));
    expect(note.content?.[0]?.content?.[1]).toMatchObject({ type: "chip", attrs: ref });
    const exported = exportMarkdown(imported);
    const parsed = importMarkdown(exported, "chips.md").json;
    expect(parsed).toEqual(imported);
  });
  it("exports unsafe or relative chip IRIs as escaped label text", () => {
    for (const iri of ["javascript:alert(1)", "relative", "", "https://u:p@evil.example/"]) {
      const output = exportMarkdown({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "chip", attrs: { iri, label: "<Private> & label", kind: "person" } }],
          },
        ],
      });
      expect(output).not.toContain("href=");
      const parsed = new window.DOMParser().parseFromString(output, "text/html");
      expect(parsed.body.textContent).toBe("<Private> & label");
      expect(parsed.querySelector("a")).toBeNull();
    }
  });
  it("never imports an unsafe chip IRI and collects person references from stored HTML", () => {
    const imported = importHtml(
      '<p><a href="javascript:bad" data-chip data-chip-kind="person">Bad</a></p>',
    );
    expect(JSON.stringify(imported.json)).not.toContain('"type":"chip"');
    expect(normaliseDestinations({ type: "chip" }, [])).toEqual({ type: "text", text: "" });
    expect(normaliseDestinations({ type: "chip", attrs: { ...ref, kind: "unknown" } }, [])).toEqual(
      { type: "text", text: "Report" },
    );
    for (const attrs of [
      undefined,
      { ...ref, label: 3 },
      { ...ref, iri: "bad" },
      { ...ref, kind: "unknown" },
    ])
      expect(() =>
        documentStatistics({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "chip", ...(attrs ? { attrs } : {}) }] },
          ],
        }),
      ).toThrow();
    expect(
      htmlChipRefs(
        '<a href="https://bob.example/#me" data-chip data-chip-kind="person" data-chip-label="Bob">Bob</a><a href="https://pod.example/file" data-chip data-chip-kind="file">File</a>',
      ),
    ).toEqual([{ iri: "https://bob.example/#me", kind: "person", label: "Bob" }]);
  });
  it("turns pasted person chips into plain links in the Docs and Notes editors", () => {
    const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(fetch)), {
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const chip = (extensions: readonly AnyExtension[]): AnyExtension[] =>
      extensions.map((extension) => (extension.name === "chip" ? suiteChipExtension() : extension));
    const editors = [
      new Editor({ extensions: chip(editorExtensions(doc, fetch)) }),
      new Editor({ extensions: chip(notesExtensions(fetch)), content: "<p></p>" }),
    ];
    for (const editor of editors) {
      const pasted: string[] = [];
      editor.on("update", ({ transaction }) => pasted.push(transaction.getMeta("uiEvent")));
      editor.view.pasteHTML(
        '<p>Hi <a href="https://bob.example/#me" data-chip data-chip-kind="person" data-chip-label="Bob">Bob</a></p>',
        new Event("paste") as ClipboardEvent,
      );
      expect(pasted).toContain("paste");
      expect(editor.getText()).toContain("Hi Bob");
      expect(editor.getHTML()).toContain('href="https://bob.example/#me"');
      expect(htmlChipRefs(editor.getHTML())).toEqual([]);
      editor.destroy();
    }
    doc.destroy();
  });
});
