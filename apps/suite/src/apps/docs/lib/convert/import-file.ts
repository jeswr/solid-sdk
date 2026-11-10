// AUTHORED-BY Codex GPT-6.1
/**
 * The file rules Docs' Upload and Drive's Open with Docs share. Kept free of the
 * converters so Drive can decide what to offer without loading the editor stack.
 */

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const IMPORTABLE = /\.(docx|html?|md|markdown|txt)$/i;

/** Whether Docs can convert a file with this name (DOCX, HTML, Markdown or plain text). */
export function isImportableName(name: string): boolean {
  return IMPORTABLE.test(name);
}

export function validateImportFile(file: Pick<File, "name" | "size">) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Choose a file of 50 MB or less");
  if (!isImportableName(file.name))
    throw new Error("Choose a DOCX, HTML, Markdown or plain text file");
}
