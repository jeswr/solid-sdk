// @vitest-environment jsdom
// AUTHORED-BY Codex
import { File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { Editor } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { describe, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport, validateImportFile } from "../src/apps/docs/editor/import-document";
import { MAX_IMPORT_BYTES } from "../src/apps/docs/lib/convert/docx-import";
import { exportMarkdown } from "../src/apps/docs/lib/convert/markdown";
import type { PodSession } from "../src/lib/session/pod-session";

const session = {
  storageUrl: "https://pod.test/",
  fetch: vi.fn<typeof fetch>(),
} as unknown as PodSession;
describe("imports through the real editor schema", () => {
  it.each([
    "image alt containing a right bracket",
    "inline code with edge spaces",
  ])("preserves %s through Markdown download and replacement in the live Y.Doc", async (finding) => {
    const doc = new Doc();
    const fetchImage = vi.fn(async () => new Response(null, { status: 404 }));
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(doc, fetchImage),
    });
    try {
      if (finding === "image alt containing a right bracket") {
        editor.commands.setImage({
          src: "https://pod.test/docs/assets/photo.png",
          alt: "Right bracket ]",
        });
      } else {
        const imported = await convertImport(
          new NodeFile(["Use ``  cat  `` here."], "code.md") as unknown as File,
          session,
          vi.fn(),
          vi.fn(),
        );
        editor.commands.setContent(imported.json);
        expect(editor.view.dom.querySelector("code")?.textContent).toBe(" cat ");
      }
      const before = editor.getJSON();
      const saved = yDocToProsemirrorJSON(doc, "prosemirror");
      const exported = exportMarkdown(saved);
      const replacement = await convertImport(
        new NodeFile([exported], "again.md") as unknown as File,
        session,
        vi.fn(),
        vi.fn(),
      );
      editor.commands.setContent(replacement.json);
      expect(editor.getJSON()).toEqual(before);
      expect(yDocToProsemirrorJSON(doc, "prosemirror")).toEqual(saved);
    } finally {
      editor.destroy();
      doc.destroy();
    }
  });
  it("maps a DOCX fixture to the editor's headings, lists, table, uploaded image and skipped report", async () => {
    const bytes = await readFile("e2e/fixtures/docs-import.docx");
    const file = new NodeFile([bytes], "fixture.docx") as unknown as File;
    const upload = vi.fn(async () => "https://pod.test/docs/fixture/assets/pixel.png");
    const result = await convertImport(file, session, upload, vi.fn());
    expect(result.title).toBe("fixture");
    expect(
      result.json.content
        ?.filter((node) => node.type !== "paragraph" || node.content?.length)
        .map((node) => node.type),
    ).toEqual(["heading", "bulletList", "table", "image", "paragraph"]);
    expect(result.json.content?.find((node) => node.type === "image")?.attrs).toMatchObject({
      src: "https://pod.test/docs/fixture/assets/pixel.png",
      alt: "Fixture image",
    });
    expect(result.skipped).toEqual([
      { label: "Footnotes", count: 1 },
      { label: "Some formatting may differ from the original", count: 1 },
    ]);
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("sets Markdown content into a local Y.Doc and exports it without a pod read", async () => {
    const source =
      '---\ntitle: "A plan"\n---\n# Plan\n\n- [x] Ready\n\n| Owner | Task |\n| --- | --- |\n| Alice | Review |\n\n==Important==\n';
    const result = await convertImport(
      new NodeFile([source], "plan.md") as unknown as File,
      session,
      vi.fn(),
      vi.fn(),
    );
    const doc = new Doc();
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(doc, session.fetch),
    });
    try {
      editor.commands.setContent(result.json);
      const local = yDocToProsemirrorJSON(doc, "prosemirror");
      const exported = exportMarkdown(local);
      expect(result.title).toBe("A plan");
      expect(
        editor.view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
      ).toBe(true);
      expect(exported).toContain("# Plan");
      expect(exported).toContain("- [x] Ready");
      expect(exported).toContain("Alice");
      expect(exported).toContain("<mark>Important</mark>");
      expect(session.fetch).not.toHaveBeenCalled();
      // The same exported file can replace the live document without changing structure.
      const before = editor.getJSON();
      const imported = await convertImport(
        new NodeFile([exported], "again.md") as unknown as File,
        session,
        vi.fn(),
        vi.fn(),
      );
      editor.commands.setContent(imported.json);
      expect(editor.getJSON()).toEqual(before);
    } finally {
      editor.destroy();
      doc.destroy();
    }
  });
  it("validates file size and type before reading the upload", () => {
    expect(() => validateImportFile({ name: "plan.docx", size: MAX_IMPORT_BYTES })).not.toThrow();
    expect(() => validateImportFile({ name: "plan.docx", size: MAX_IMPORT_BYTES + 1 })).toThrow(
      "50 MB",
    );
    expect(() => validateImportFile({ name: "plan.pdf", size: 1 })).toThrow("DOCX or Markdown");
  });
  it("sanitizes embedded Markdown HTML through the schema without corrupting code", async () => {
    const source =
      '<p onclick="evil()">Safe <strong>bold</strong><a href="javascript:evil()">link</a><img src="data:image/png;base64,x" onerror="evil()"></p>\n\n```html\n<script>example()</script>\n```';
    const result = await convertImport(
      new NodeFile([source], "html.md") as unknown as File,
      session,
      vi.fn(),
      vi.fn(),
    );
    expect(result.html).not.toContain("onclick=");
    expect(result.html).not.toContain("onerror=");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("data:image");
    expect(result.html).toContain("&lt;script&gt;example()&lt;/script&gt;");
  });
});
