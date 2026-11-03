// AUTHORED-BY Codex GPT-6.1-Sol
export const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const STRICT_MAIN = "http://purl.oclc.org/ooxml/spreadsheetml/main";
export const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const STRICT_REL = "http://purl.oclc.org/ooxml/officeDocument/relationships";
export const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
export const LIMITS = {
  entries: 1000,
  entryBytes: 20 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  sheets: 200,
  rows: 100_000,
  columns: 16_384,
  cells: 2_000_000,
  merges: 100_000,
  /** UTF-16 code units of cell text and formulas, counted per cell even when strings are shared. */
  text: 20_000_000,
};

export class XlsxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxImportError";
  }
}

export function requireXlsx(condition: unknown, message: string): asserts condition {
  if (!condition) throw new XlsxImportError(message);
}

export function elements(root: Document | Element, name: string): Element[] {
  return [
    ...root.getElementsByTagNameNS(MAIN, name),
    ...root.getElementsByTagNameNS(STRICT_MAIN, name),
  ];
}

export function coordinate(ref: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})(?![\s\S])/.exec(ref);
  requireXlsx(match, "Invalid Excel cell reference");
  let column = 0;
  for (const char of match[1] as string) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  requireXlsx(row <= LIMITS.rows && column <= LIMITS.columns, "Excel row or column limit exceeded");
  return { row: row - 1, column: column - 1 };
}

export function cellRef(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

function cleanXml(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 excludes these code points
      .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
  );
}

export function xml(value: string): string {
  return cleanXml(value).replace(
    /[&<>"'\t\r\n]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\t": "&#9;",
        "\r": "&#13;",
        "\n": "&#10;",
      })[char] as string,
  );
}

export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base =
      cleanXml(
        cleanXml(name)
          .replace(/[[\]:*?/\\]/g, "")
          .replace(/^'+|'+$/g, "")
          .slice(0, 31)
          .replace(/'+$/g, ""),
      ) || "Sheet";
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = `${cleanXml(base.slice(0, 31 - suffix.length))}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
