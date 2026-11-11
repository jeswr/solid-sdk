// AUTHORED-BY Codex GPT-6.1-Sol
import type { IWorkbookData } from "@univerjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readXlsx, XlsxImportError } from "../src/apps/sheets/lib/xlsx";
import { LIMITS, MAIN, REL, STRICT_REL } from "../src/apps/sheets/lib/xlsx/common";
import "./drive-ui-dom";
import {
  bookXml,
  cellsXml,
  fixture,
  relationship,
  relsXml,
  worksheet,
} from "./sheets-xlsx-fixtures";

const read = (files: Parameters<typeof fixture>[0] = {}) =>
  readXlsx(fixture(files), { title: "Imported" }) as unknown as IWorkbookData;
const partRel = (kind: string, target: string, extra = "") =>
  `<Relationship Id="${kind}" Type="${REL}/${kind}" Target="${target}" ${extra}/>`;
const strings = `<sst xmlns="${MAIN}"><si><t>Related text</t></si></sst>`;
const styles = `<styleSheet xmlns="${MAIN}"><cellXfs><xf numFmtId="2"/></cellXfs></styleSheet>`;
const cell = '<c t="s"><v>0</v></c>';

beforeEach(() => vi.stubGlobal("DOMParser", window.DOMParser));
afterEach(() => vi.restoreAllMocks());

describe("Excel package part resolution", () => {
  it.each([
    REL,
    STRICT_REL,
  ])("resolves relocated parts using %s relationships and ignores conventional decoys", (namespace) => {
    const result = read({
      "_rels/.rels": relsXml(partRel("officeDocument", "./books/../books/main.xml")).replaceAll(
        REL,
        namespace,
      ),
      "books/main.xml": bookXml(),
      "books/_rels/main.xml.rels": relsXml(
        relationship("../tables/data.xml") +
          partRel("sharedStrings", "../text/strings.xml") +
          partRel("styles", "/formats/styles.xml"),
      ).replaceAll(REL, namespace),
      "tables/data.xml": cellsXml(cell),
      "text/strings.xml": strings,
      "formats/styles.xml": styles,
      "xl/workbook.xml": "invalid decoy",
      "xl/_rels/workbook.xml.rels": "invalid decoy",
      "xl/sharedStrings.xml": "x".repeat(LIMITS.entryBytes + 1),
      "xl/styles.xml": "invalid decoy",
    });
    expect(result.sheets.sheet1?.cellData?.[0]?.[0]).toEqual({
      v: "Related text",
      t: 1,
      s: { n: { pattern: "0.00" } },
    });
  });

  it("resolves a workbook at the package root and falls back only for absent relationships", () => {
    expect(
      read({
        "_rels/.rels": relsXml(partRel("officeDocument", "/book.xml")),
        "book.xml": bookXml(),
        "_rels/book.xml.rels": relsXml(relationship("xl/worksheets/data.xml")),
        "xl/sharedStrings.xml": strings,
        "xl/styles.xml": styles,
        "xl/worksheets/data.xml": cellsXml(cell),
      }).sheets.sheet1?.cellData?.[0]?.[0],
    ).toEqual({ v: "Related text", t: 1, s: { n: { pattern: "0.00" } } });
    expect(read({ "_rels/.rels": relsXml('<Relationship Id="ignored"/>') }).sheetOrder).toEqual([
      "sheet1",
    ]);
  });

  it.each([
    "officeDocument",
    "sharedStrings",
    "styles",
  ])("does not fall back when a %s relationship points to a missing part", (kind) => {
    const files =
      kind === "officeDocument"
        ? { "_rels/.rels": relsXml(partRel(kind, "missing.xml")) }
        : { "xl/_rels/workbook.xml.rels": relsXml(relationship() + partRel(kind, "missing.xml")) };
    expect(() =>
      read({ ...files, "xl/sharedStrings.xml": strings, "xl/styles.xml": styles }),
    ).toThrow("missing");
  });

  it.each([
    "officeDocument",
    "sharedStrings",
    "styles",
  ])("rejects external and escaping %s targets", (kind) => {
    for (const [target, extra, message] of [
      ["remote.xml", 'TargetMode="External"', "External"],
      ["../../outside.xml", "", "leaves the package"],
    ]) {
      const rel = partRel(kind, target as string, extra);
      const files =
        kind === "officeDocument"
          ? { "_rels/.rels": relsXml(rel) }
          : { "xl/_rels/workbook.xml.rels": relsXml(relationship() + rel) };
      expect(() => read(files)).toThrow(message);
    }
  });

  it("rejects duplicate root relationship IDs and malformed root relationships", () => {
    expect(() =>
      read({ "_rels/.rels": relsXml(partRel("officeDocument", "xl/workbook.xml").repeat(2)) }),
    ).toThrow("Duplicate Excel relationship");
    expect(() => read({ "_rels/.rels": "<unclosed>" })).toThrow("Invalid Excel XML");
  });

  it("shares the byte budget across relationship discovery and referenced parts", () => {
    const files = {
      "_rels/.rels": relsXml(partRel("officeDocument", "xl/workbook.xml")),
      "xl/sharedStrings.xml": strings,
      "xl/styles.xml": styles,
    };
    const bytes = fixture(files);
    const total = LIMITS.totalBytes;
    // All selected parts fit individually but not together.
    LIMITS.totalBytes = 700;
    try {
      expect(() => readXlsx(bytes, { title: "Budget" })).toThrow("uncompressed size");
    } finally {
      LIMITS.totalBytes = total;
    }
  });
});

describe("Excel complexity and compressed input limits", () => {
  it("rejects more than 50 MiB before unzipping", () => {
    expect(LIMITS.compressedBytes).toBe(50 * 1024 * 1024);
    expect(() =>
      readXlsx(new Uint8Array(LIMITS.compressedBytes + 1), { title: "Too large" }),
    ).toThrow(new XlsxImportError("Excel files must be 50 MiB or smaller"));
    const bytes = fixture();
    const limit = LIMITS.compressedBytes;
    LIMITS.compressedBytes = bytes.length;
    try {
      expect(readXlsx(bytes, { title: "At limit" }).sheetOrder).toEqual(["sheet1"]);
      expect(() => readXlsx(new Uint8Array(bytes.length + 1), { title: "Over" })).toThrow("50 MiB");
    } finally {
      LIMITS.compressedBytes = limit;
    }
  });

  it("rejects over two million markup delimiters before DOM parsing", () => {
    expect(LIMITS.elements).toBe(2_000_000);
    const parse = vi.spyOn(window.DOMParser.prototype, "parseFromString");
    const complex = worksheet("<x/>".repeat(LIMITS.elements));
    expect(() => read({ "xl/worksheets/data.xml": complex })).toThrow("file is too complex");
    expect(parse.mock.calls.some(([text]) => text === complex)).toBe(false);
  });

  it.each([false, true])("counts delimiters after decoding UTF-16, bigEndian=%s", (bigEndian) => {
    const limit = LIMITS.elements;
    LIMITS.elements = 10;
    try {
      const bytes = Buffer.from(worksheet("<x/>".repeat(9)), "utf16le");
      if (bigEndian) bytes.swap16();
      expect(() => read({ "xl/worksheets/data.xml": bytes })).toThrow("file is too complex");
      expect(read({ "xl/worksheets/data.xml": worksheet("<x/>".repeat(8)) }).sheetOrder).toEqual([
        "sheet1",
      ]);
    } finally {
      LIMITS.elements = limit;
    }
  });
});

describe("Excel implicit row and cell positions", () => {
  it("infers positions from the previous row and cell, resets columns and preserves heights", () => {
    const result = read({
      "xl/worksheets/data.xml": worksheet(
        '<sheetData><row ht="12"><c><v>1</v></c><c><v>2</v></c><c r="D1"><v>4</v></c><c><v>5</v></c></row><row><c><v>6</v></c></row><row r="4"><c r="C4"/><c><v>7</v></c></row><row ht="24"><c><v>8</v></c></row></sheetData>',
      ),
    }).sheets.sheet1;
    expect(result?.cellData).toEqual({
      0: { 0: { v: 1, t: 2 }, 1: { v: 2, t: 2 }, 3: { v: 4, t: 2 }, 4: { v: 5, t: 2 } },
      1: { 0: { v: 6, t: 2 } },
      3: { 2: {}, 3: { v: 7, t: 2 } },
      4: { 0: { v: 8, t: 2 } },
    });
    expect(result?.rowData).toEqual({ 0: { h: 16 }, 4: { h: 32 } });
  });

  it("keeps duplicate checks for inferred rows and cells", () => {
    for (const [body, message] of [
      ['<row/><row r="1"/>', "Duplicate Excel row"],
      ['<row r="2"/><row r="1"/><row/>', "Duplicate Excel row"],
      ['<row><c/><c r="A1"/></row>', "Duplicate Excel cell"],
      ['<row><c r="B1"/><c r="A1"/><c/></row>', "Duplicate Excel cell"],
    ])
      expect(() =>
        read({ "xl/worksheets/data.xml": worksheet(`<sheetData>${body}</sheetData>`) }),
      ).toThrow(message);
  });

  it("enforces the column cap on inferred cells", () => {
    expect(() => read({ "xl/worksheets/data.xml": cellsXml('<c r="XFD1"/><c/>') })).toThrow(
      "column limit",
    );
  });
});

it("stops at the shared budget while relationships are still being inflated", () => {
  const limit = LIMITS.totalBytes;
  LIMITS.totalBytes = 1;
  try {
    expect(() =>
      read({ "_rels/.rels": relsXml(partRel("officeDocument", "xl/workbook.xml")) }),
    ).toThrow("uncompressed size");
  } finally {
    LIMITS.totalBytes = limit;
  }
});
