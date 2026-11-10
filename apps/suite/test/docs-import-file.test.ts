// AUTHORED-BY Codex GPT-6.1
import { describe, expect, it } from "vitest";
import { validateImportFile as editorValidate } from "../src/apps/docs/editor/import-document";
import { MAX_IMPORT_BYTES as converterLimit } from "../src/apps/docs/lib/convert/docx-import";
import {
  isImportableName,
  MAX_IMPORT_BYTES,
  validateImportFile,
} from "../src/apps/docs/lib/convert/import-file";

describe("Docs' converter-free import rules", () => {
  it("are the single source the editor importer and converters re-export", () => {
    expect(editorValidate).toBe(validateImportFile);
    expect(converterLimit).toBe(MAX_IMPORT_BYTES);
    expect(MAX_IMPORT_BYTES).toBe(50 * 1024 * 1024);
  });
  it("accept all supported import names, case-insensitively", () => {
    for (const name of [
      "plan.docx",
      "PLAN.DOCX",
      "notes.md",
      "notes.Markdown",
      "page.HTML",
      "page.htm",
      "notes.txt",
    ])
      expect(isImportableName(name)).toBe(true);
    for (const name of ["plan.doc", "md", "plan.docx.exe", ""])
      expect(isImportableName(name)).toBe(false);
  });
  it("reject oversized files before their type", () => {
    expect(() => validateImportFile({ name: "plan.docx", size: MAX_IMPORT_BYTES })).not.toThrow();
    expect(() => validateImportFile({ name: "plan.pdf", size: MAX_IMPORT_BYTES + 1 })).toThrow(
      "50 MB or less",
    );
    expect(() => validateImportFile({ name: "plan.pdf", size: 1 })).toThrow(
      "DOCX, HTML, Markdown or plain text",
    );
  });
});
