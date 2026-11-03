// AUTHORED-BY Codex GPT-6.1-Sol
import type { IWorkbookData, IWorksheetData } from "@univerjs/core";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../src/apps/sheets/lib/model/snapshot";
import { serializeSnapshot } from "../src/apps/sheets/lib/model/snapshot";
import { readXlsx, writeXlsx, XlsxImportError } from "../src/apps/sheets/lib/xlsx";
import {
  cellRef,
  coordinate,
  LIMITS,
  MAIN,
  REL,
  STRICT_MAIN,
  STRICT_REL,
  sheetNames,
  xml,
} from "../src/apps/sheets/lib/xlsx/common";
import "./drive-ui-dom";
import {
  bookXml,
  cellsXml,
  fixture,
  relationship,
  relsXml,
  worksheet,
} from "./sheets-xlsx-fixtures";

beforeEach(() => vi.stubGlobal("DOMParser", window.DOMParser));
afterEach(() => vi.restoreAllMocks());
const read = (bytes = fixture()) =>
  readXlsx(bytes, { title: "Imported" }) as unknown as IWorkbookData & {
    sheets: { sheet1: Partial<IWorksheetData>; sheet2: Partial<IWorksheetData> };
  };
const sheet = (body: string) =>
  read(fixture({ "xl/worksheets/data.xml": worksheet(body) })).sheets.sheet1;
const cell = (body: string) =>
  read(fixture({ "xl/worksheets/data.xml": cellsXml(body) })).sheets.sheet1.cellData?.[0]?.[0];
const rejects = (files: Parameters<typeof fixture>[0], message: string) => {
  expect(() => read(fixture(files))).toThrow(XlsxImportError);
  expect(() => read(fixture(files))).toThrow(message);
};

describe("Excel supported data", () => {
  it("reads shared and rich strings, scalar types, formulas and number formats", () => {
    const result = read(
      fixture({
        "xl/sharedStrings.xml": `<sst xmlns="${MAIN}"><si><t> plain </t></si><si><r><t>Rich</t></r><r><t> text</t></r></si></sst>`,
        "xl/styles.xml": `<styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164" formatCode="0.000 &amp; &quot;kg&quot;"/></numFmts><cellXfs><xf/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/><xf numFmtId="21"/><xf numFmtId="999"/></cellXfs></styleSheet>`,
        "xl/worksheets/data.xml": cellsXml(
          '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><r><t>Inline</t></r><r><t> text</t></r></is></c><c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c><c r="F1" t="e"><v>#DIV/0!</v></c><c r="G1" t="str"><f>IF(A1=&quot;x&quot;,&quot;yes&quot;,&quot;no&quot;)</f><v>no</v></c><c r="H1" s="1"><v>45200</v></c><c r="I1" s="2"><f>SUM(H1,1)</f><v>45201</v></c><c r="J1" s="3"><v>0.5</v></c><c r="K1" s="4"><v>0.25</v></c><c r="L1" s="5"><f t="shared" si="0">H1+1</f><v>45201</v></c><c r="M1"><f t="shared" si="0"/><v>45202</v></c><c r="N1" t="d"><v>2026-11-02</v></c><c r="O1"><f>NA()</f></c><c r="P1"/>',
        ),
      }),
    );
    expect(result.sheetOrder).toEqual(["sheet1"]);
    expect(result.sheets.sheet1.cellData?.[0]).toEqual({
      0: { v: " plain ", t: 1 },
      1: { v: "Rich text", t: 1 },
      2: { v: "Inline text", t: 1 },
      3: { v: 1, t: 3 },
      4: { v: 0, t: 3 },
      5: { v: "#DIV/0!", t: 1 },
      6: { v: "no", t: 1, f: '=IF(A1="x","yes","no")' },
      7: { v: 45200, t: 2, s: { n: { pattern: "m/d/yyyy" } } },
      8: { v: 45201, t: 2, f: "=SUM(H1,1)", s: { n: { pattern: '0.000 & "kg"' } } },
      9: { v: 0.5, t: 2, s: { n: { pattern: "0%" } } },
      10: { v: 0.25, t: 2, s: { n: { pattern: "h:mm:ss" } } },
      11: { v: 45201, t: 2, f: "=H1+1" },
      12: { v: 45202, t: 2 },
      13: { v: "2026-11-02", t: 1 },
      14: { f: "=NA()" },
      15: {},
    });
    expect(() => serializeSnapshot(result as unknown as Snapshot)).not.toThrow();
  });

  it("preserves merges, panes, row heights, column widths and worksheet order through a round trip", () => {
    const result = read(
      fixture({
        "xl/workbook.xml": bookXml(
          '<sheet name="Second &amp; more" r:id="r2"/><sheet name="Chart" r:id="chart"/><sheet name="Data" r:id="r1"/>',
        ),
        "xl/_rels/workbook.xml.rels": relsXml(
          `${relationship()}<Relationship Id="r2" Type="${REL}/worksheet" Target="./worksheets/../worksheets/other.xml"/><Relationship Id="chart" Type="${REL}/chartsheet" Target="chartsheets/ignored.xml"/>`,
        ),
        "xl/worksheets/other.xml": worksheet(
          '<sheetViews><sheetView topLeftCell="B5"><pane state="frozen" xSplit="2" ySplit="1" topLeftCell="D9"/></sheetView></sheetViews><cols><col min="1" max="2" width="12"/><col min="3" max="3"/></cols><sheetData><row r="1" ht="24"><c r="A1" t="inlineStr"><is><t>Hello &amp; &lt;world&gt;</t></is></c><c r="B1"><v>3.5</v></c></row><row r="3"/></sheetData><mergeCells><mergeCell ref="B2:D3"/></mergeCells>',
        ),
      }),
    );
    expect(
      result.sheetOrder.map((id) => (result.sheets[id] as Partial<IWorksheetData>).name),
    ).toEqual(["Second & more", "Data"]);
    expect(result.sheets.sheet1).toMatchObject({
      // The sheet grows to cover its frozen rows (5) as well as its merges (D3).
      rowCount: 5,
      columnCount: 4,
      // Rows 5 and columns B:C are frozen; the pane's own topLeftCell is only a scroll position.
      freeze: { xSplit: 2, ySplit: 1, startRow: 5, startColumn: 3 },
      rowData: { 0: { h: 32 } },
      columnData: { 0: { w: 89 }, 1: { w: 89 } },
      mergeData: [{ startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 }],
    });
    const bytes = writeXlsx(result as unknown as Snapshot);
    expect(read(bytes)).toEqual(result);
    const files = unzipSync(bytes);
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]) {
      expect(files[name]).toBeDefined();
      expect(
        new DOMParser()
          .parseFromString(strFromU8(files[name] as Uint8Array), "application/xml")
          .getElementsByTagName("parsererror"),
      ).toHaveLength(0);
    }
  });

  it("round trips cached formulas and deduplicates inline and referenced number formats", () => {
    const result = read(
      fixture({
        "xl/worksheets/data.xml": cellsXml(
          '<c r="A1"><f>A2+1</f><v>4</v></c><c r="B1" t="str"><f>UNKNOWN()</f><v>cached</v></c>',
        ),
      }),
    );
    result.styles = { date: { n: { pattern: 'yyyy-mm-dd & "date"' } } };
    const cells = result.sheets.sheet1.cellData as NonNullable<
      IWorkbookData["sheets"][string]["cellData"]
    >;
    const first = cells[0]?.[0];
    const second = cells[0]?.[1];
    assert(first && second);
    first.s = "date";
    second.s = { n: { pattern: 'yyyy-mm-dd & "date"' } };
    const imported = read(writeXlsx(result as unknown as Snapshot));
    expect(imported.sheets.sheet1.cellData?.[0]?.[0]).toEqual({
      ...first,
      s: result.styles.date,
    });
    expect(imported.sheets.sheet1.cellData?.[0]?.[1]).toEqual(second);
    expect(
      strFromU8(unzipSync(writeXlsx(result as unknown as Snapshot))["xl/styles.xml"] as Uint8Array),
    ).toContain('<numFmts count="1">');
  });

  it("accepts strict namespaces, package absolute paths and untrusted sheet and relationship ids", () => {
    const files = {
      "xl/workbook.xml": bookXml('<sheet name="constructor" sheetId="__proto__" r:id="__proto__"/>')
        .replaceAll(MAIN, STRICT_MAIN)
        .replaceAll(REL, STRICT_REL),
      "xl/_rels/workbook.xml.rels": relsXml(
        relationship("/xl/worksheets/data.xml")
          .replace('Id="r1"', 'Id="__proto__"')
          .replaceAll(REL, STRICT_REL),
      ),
      "xl/worksheets/data.xml": cellsXml('<c r="AA2"><v>5</v></c>').replaceAll(MAIN, STRICT_MAIN),
    };
    expect(read(fixture(files)).sheets.sheet1).toMatchObject({
      id: "sheet1",
      name: "constructor",
      cellData: { 1: { 26: { v: 5, t: 2 } } },
    });
    expect({}).not.toHaveProperty("polluted");
  });

  it("handles missing optional metadata, default names and pane positions", () => {
    expect(read().sheets.sheet1).toMatchObject({ rowCount: 1, columnCount: 1, cellData: {} });
    expect(
      read(
        fixture({
          "xl/workbook.xml": bookXml('<sheet r:id="r1"/>'),
          "xl/styles.xml": `<styleSheet xmlns="${MAIN}"/>`,
        }),
      ).sheets.sheet1.name,
    ).toBe("Sheet");
    expect(
      sheet(
        '<sheetViews><sheetView><pane state="frozenSplit" ySplit="2"/></sheetView></sheetViews>',
      ).freeze,
    ).toEqual({ xSplit: 0, ySplit: 2, startRow: 2, startColumn: -1 });
    expect(
      sheet('<sheetViews><sheetView><pane state="split"/></sheetView></sheetViews>').freeze,
    ).toBeUndefined();
    expect(cell('<c r="A1" t="inlineStr"/>')).toEqual({ v: "", t: 1 });
    expect(cell('<c r="A1"><f>1+2</f><v/></c>')).toEqual({ f: "=1+2" });
    expect(cell('<c r="A1"><f t="shared" si="0"/><v/></c>')).toEqual({});
    expect(cell('<c r="A1" t="str"><f>IF(1,&quot;&quot;)</f><v/></c>')).toEqual({
      f: '=IF(1,"")',
      v: "",
      t: 1,
    });
    expect(
      read(
        fixture({
          "xl/styles.xml": `<styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164"/></numFmts><cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>`,
          "xl/worksheets/data.xml": cellsXml('<c r="A1"><v>1</v></c>'),
        }),
      ).sheets.sheet1.cellData?.[0]?.[0],
    ).toEqual({ v: 1, t: 2 });
  });

  it("writes numbers the engine stored as text as numbers", () => {
    const result = {
      sheetOrder: ["a"],
      sheets: {
        a: { name: "A", cellData: { 0: { 0: { v: " 12.5", t: 2 }, 1: { v: " ", t: 2 } } } },
      },
    } as unknown as Snapshot;
    expect(read(writeXlsx(result)).sheets.sheet1.cellData?.[0]).toEqual({
      0: { v: 12.5, t: 2 },
      1: { v: " ", t: 1 },
    });
  });
  it("writes sparse engine snapshots, boolean encodings, plain rich text and empty cells", () => {
    const result = {
      sheetOrder: ["a", "b", "c"],
      sheets: {
        a: {
          name: "A",
          cellData: {
            2: { 2: { v: true }, 1: { v: false }, 0: { v: "1", t: 3 } },
            0: {
              0: { v: 0, t: 3 },
              1: { v: 1, t: 3 },
              2: {},
              3: { f: "=NO_CACHE()" },
              4: { p: { body: { dataStream: " rich\r\n" } } },
              5: { v: "raw", s: "missing" },
            },
          },
          rowData: { 4: { h: 20 } },
          columnData: { 0: {}, 1: { w: 3 } },
          freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
        },
        b: {
          name: "B",
          rowData: { 0: { h: 40 } },
          freeze: { xSplit: 0, ySplit: 2, startRow: 2, startColumn: 0 },
        },
        c: {},
      },
    } as unknown as Snapshot;
    const data = read(writeXlsx(result));
    expect(data.sheets.sheet1.cellData?.[2]).toMatchObject({
      0: { v: 1, t: 3 },
      1: { v: 0, t: 3 },
      2: { v: 1, t: 3 },
    });
    expect(data.sheets.sheet1.cellData?.[0]).toMatchObject({
      0: { v: 0, t: 3 },
      1: { v: 1, t: 3 },
      2: {},
      3: { f: "=NO_CACHE()" },
      4: { v: " rich", t: 1 },
      5: { v: "raw" },
    });
    expect(data.sheets.sheet1.columnData?.[1]?.w).toBe(5);
    expect(data.sheets.sheet2.freeze?.ySplit).toBe(2);
  });

  it("sanitises Excel names and XML characters, keeping text safe", () => {
    expect(
      sheetNames([
        "[]:*?/\\",
        "'Sheet'",
        "sheet",
        "x".repeat(40),
        "x".repeat(40),
        "a",
        "a",
        "a",
        "\u0000",
      ]),
    ).toEqual([
      "Sheet",
      "Sheet (2)",
      "sheet (3)",
      "x".repeat(31),
      `${"x".repeat(27)} (2)`,
      "a",
      "a (2)",
      "a (3)",
      "Sheet (4)",
    ]);
    expect(xml("&<>\"'\u0000\ud800\ufffe😀\r\n\t")).toBe(
      "&amp;&lt;&gt;&quot;&apos;😀&#13;&#10;&#9;",
    );
    expect(sheetNames([`${"x".repeat(30)}😀`, "x".repeat(30)])).toEqual([
      "x".repeat(30),
      `${"x".repeat(27)} (2)`,
    ]);
    const result = read();
    result.sheets.sheet1.name = "[bad]/name";
    result.sheets.sheet1.cellData = { 0: { 0: { v: "&<>\"'\u0001😀" } } };
    const imported = read(writeXlsx(result as unknown as Snapshot));
    expect(imported.sheets.sheet1.name).toBe("badname");
    expect(imported.sheets.sheet1.cellData?.[0]?.[0]?.v).toBe("&<>\"'😀");
    expect(coordinate("XFD100000")).toEqual({ row: 99999, column: 16383 });
    expect(cellRef(99999, 16383)).toBe("XFD100000");
  });
});

// Every fixture is generated XML in a real ZIP; no binary fixtures are checked in.
describe("Excel hostile input", () => {
  it("wraps invalid ZIPs and missing parts in a user-facing error", () => {
    expect(() => read(new Uint8Array([1, 2, 3]))).toThrow("Choose a valid .xlsx file");
    for (const part of [
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/data.xml",
    ])
      rejects({ [part]: null }, "missing");
  });
  it.each([
    "<!DOCTYPE worksheet><worksheet/>",
    '<!DOCTYPE worksheet [<!ENTITY bomb "boom">]><worksheet>&bomb;</worksheet>',
    '<worksheet xmlns="broken"><unclosed>',
  ])("rejects DTDs and malformed XML: %s", (bad) =>
    rejects(
      { "xl/worksheets/data.xml": bad },
      bad.startsWith("<!DOCTYPE") ? "DOCTYPE" : "Invalid Excel XML",
    ));
  it.each([true, false])("rejects UTF-16 DTDs with bigEndian=%s", (bigEndian) => {
    const data = Buffer.from("\ufeff<!DOCTYPE worksheet><worksheet/>", "utf16le");
    if (bigEndian) data.swap16();
    rejects({ "xl/worksheets/data.xml": data }, "DOCTYPE");
    const valid = Buffer.from(worksheet(), "utf16le");
    if (bigEndian) valid.swap16();
    expect(read(fixture({ "xl/worksheets/data.xml": valid })).sheetOrder).toEqual(["sheet1"]);
  });
  it.each([
    "../../outside.xml",
    "https://evil.test/x.xml",
    "//evil/x.xml",
    "bad\\path.xml",
    "%2e%2e/out.xml",
    "worksheets/a.xml#x",
    "../",
    "__proto__",
    "constructor",
    "prototype",
    "",
  ])("rejects unsafe relationship target %s", (target) =>
    rejects(
      { "xl/_rels/workbook.xml.rels": relsXml(relationship(target)) },
      target === "../../outside.xml" ? "leaves the package" : "Invalid Excel relationship target",
    ));
  it("rejects external worksheets, duplicate relationships, missing relationships and macros", () => {
    rejects(
      { "xl/_rels/workbook.xml.rels": relsXml(relationship("a.xml", 'TargetMode="External"')) },
      "External",
    );
    rejects(
      { "xl/_rels/workbook.xml.rels": relsXml(relationship() + relationship()) },
      "Duplicate Excel relationship",
    );
    rejects(
      { "xl/_rels/workbook.xml.rels": relsXml('<Relationship Type="ignored"/>') },
      "Missing Excel sheet relationship",
    );
    rejects({ "xl/workbook.xml": bookXml("<sheet/>") }, "Missing Excel sheet relationship");
    rejects(
      { "xl/_rels/workbook.xml.rels": relsXml(`<Relationship Id="r1" Type="${REL}/worksheet"/>`) },
      "Invalid Excel relationship target",
    );
    rejects({ "xl/vbaProject.bin": "macro" }, "Macro-enabled");
    rejects(
      {
        "[Content_Types].xml":
          '<Types><Override/><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>',
      },
      "Macro-enabled",
    );
    for (const date of ["1", "true"])
      rejects(
        { "xl/workbook.xml": bookXml(undefined, `<workbookPr date1904="${date}"/>`) },
        "1904",
      );
  });
  it.each([
    "__proto__",
    "constructor",
    "A0",
    "a1",
    "$A$1",
    "A100001",
    "XFE1",
    "A12345678",
    "",
  ])("rejects invalid or oversized cell reference %s", (ref) =>
    rejects(
      { "xl/worksheets/data.xml": cellsXml(`<c r="${ref}"/>`) },
      ref === "A100001" || ref === "XFE1" ? "limit" : "reference",
    ));
  it("rejects missing and duplicate cell refs", () => {
    rejects({ "xl/worksheets/data.xml": cellsXml("<c/>") }, "reference");
    rejects({ "xl/worksheets/data.xml": cellsXml('<c r="A1"/><c r="A1"/>') }, "Duplicate");
  });
  it.each(["-1", "NaN", "Infinity"])("rejects invalid numeric attributes %s", (ht) =>
    rejects(
      { "xl/worksheets/data.xml": worksheet(`<sheetData><row r="1" ht="${ht}"/></sheetData>`) },
      "Invalid Excel ht",
    ));
  it("reads an empty value as an empty cell", () => expect(cell('<c r="A1"><v/></c>')).toEqual({}));
  it.each([" ", "NaN", "Infinity"])("rejects invalid numeric cells %s", (n) =>
    rejects(
      { "xl/worksheets/data.xml": cellsXml(`<c r="A1"><v>${n}</v></c>`) },
      "Invalid Excel number",
    ));
  it.each(["", "-1", "0.5", "1", "NaN"])("rejects invalid shared string index %s", (n) =>
    rejects(
      {
        "xl/worksheets/data.xml": cellsXml(`<c r="A1" t="s">${n === "" ? "" : `<v>${n}</v>`}</c>`),
        "xl/sharedStrings.xml": `<sst xmlns="${MAIN}"><si><t>x</t></si></sst>`,
      },
      "shared string",
    ));
  it.each(["<row/>", '<row r="0"/>', '<row r="0.5"/>'])("rejects invalid row %s", (row) =>
    rejects(
      { "xl/worksheets/data.xml": worksheet(`<sheetData>${row}</sheetData>`) },
      "Invalid Excel row",
    ));
  it("skips empty rows past the row limit but rejects cells there", () => {
    expect(sheet('<sheetData><row r="1048576" ht="20"/></sheetData>').rowCount).toBe(1);
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          '<sheetData><row r="100001"><c r="A100001"><v>1</v></c></row></sheetData>',
        ),
      },
      "row limit",
    );
  });
  it("keeps column widths for used columns without growing the sheet", () => {
    const wide = sheet(
      '<cols><col min="1" max="16384" width="10"/></cols><sheetData><row r="1"><c r="AD1"><v>1</v></c></row></sheetData>',
    );
    expect(wide.columnCount).toBe(30);
    expect(Object.keys(wide.columnData ?? {})).toHaveLength(30);
    const narrow = sheet('<cols><col min="2" max="16384" width="10"/></cols>');
    expect(narrow.columnCount).toBe(1);
    expect(Object.keys(narrow.columnData ?? {})).toHaveLength(25);
  });
  it("leaves out phonetic runs from string text", () =>
    expect(
      cell(
        '<c r="A1" t="inlineStr"><is><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></is></c>',
      ),
    ).toEqual({ v: "東京", t: 1 }));
  it.each([
    "<col/>",
    '<col min="0.5" max="1"/>',
    '<col min="1" max="1.5"/>',
    '<col min="0" max="1"/>',
    '<col min="2" max="1"/>',
    '<col min="1" max="16385"/>',
  ])("rejects invalid column %s", (col) =>
    rejects({ "xl/worksheets/data.xml": worksheet(`<cols>${col}</cols>`) }, "column limit"));
  it.each([
    "<mergeCell/>",
    '<mergeCell ref="A1"/>',
    '<mergeCell ref="B2:A3"/>',
    '<mergeCell ref="B2:C1"/>',
  ])("rejects invalid merge %s", (merge) =>
    rejects(
      { "xl/worksheets/data.xml": worksheet(`<mergeCells>${merge}</mergeCells>`) },
      "merge range",
    ));
  it.each([
    'xSplit="0.5"',
    'ySplit="0.5"',
    'xSplit="16385"',
    'ySplit="100001"',
  ])("rejects invalid frozen pane %s", (attr) =>
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          `<sheetViews><sheetView><pane state="frozen" ${attr}/></sheetView></sheetViews>`,
        ),
      },
      "frozen pane",
    ));
  it("caps sheets and occupied grid area", () => {
    rejects({ "xl/workbook.xml": bookXml("") }, "between 1 and 200");
    rejects(
      { "xl/workbook.xml": bookXml('<sheet name="repeat" r:id="r1"/>'.repeat(201)) },
      "between 1 and 200",
    );
    rejects({ "xl/worksheets/data.xml": cellsXml('<c r="XFD100000"/>') }, "occupied grid");
  });
  it("caps actual cells before doing excessive work", () => {
    const maximum = LIMITS.cells;
    LIMITS.cells = 1;
    try {
      rejects({ "xl/worksheets/data.xml": cellsXml('<c r="A1"/><c r="B1"/>') }, "Excel cell limit");
    } finally {
      LIMITS.cells = maximum;
    }
  });
});

// Modify only directory metadata, so these bomb regressions allocate tiny archives.
function directoryEntries(
  bytes: Uint8Array,
  update: (view: DataView, offset: number, name: string) => void,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const length = view.getUint16(i + 28, true);
    update(view, i, strFromU8(bytes.subarray(i + 46, i + 46 + length)));
    i += 45 + length;
  }
  return bytes;
}
// Rewrite a local file header field, which the streaming reader trusts for layout only.
function localEntries(
  bytes: Uint8Array,
  update: (view: DataView, offset: number, name: string) => void,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 30; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const length = view.getUint16(i + 26, true);
    update(view, i, strFromU8(bytes.subarray(i + 30, i + 30 + length)));
    i += 29 + length;
  }
  return bytes;
}
it("counts inflated bytes against the size limits, whatever sizes the ZIP declares", () => {
  const { entryBytes, totalBytes } = LIMITS;
  LIMITS.entryBytes = 1000;
  LIMITS.totalBytes = 1500;
  try {
    const understated = (bytes: Uint8Array) =>
      directoryEntries(
        localEntries(bytes, (view, offset) => view.setUint32(offset + 22, 10, true)),
        (view, offset) => view.setUint32(offset + 24, 10, true),
      );
    // One highly compressible part inflates past the entry limit.
    expect(() =>
      read(understated(fixture({ "xl/worksheets/data.xml": worksheet(" ".repeat(5000)) }))),
    ).toThrow("uncompressed size");
    // Parts within the entry limit add up past the total, across both extraction passes.
    expect(() =>
      read(
        understated(
          fixture({
            "xl/sharedStrings.xml": `<sst xmlns="${MAIN}">${" ".repeat(700)}</sst>`,
            "xl/worksheets/data.xml": worksheet(" ".repeat(700)),
          }),
        ),
      ),
    ).toThrow("uncompressed size");
    // Large parts that are never read don't count.
    expect(read(fixture({ "xl/media/image1.png": "x".repeat(5000) })).sheetOrder).toEqual([
      "sheet1",
    ]);
  } finally {
    LIMITS.entryBytes = entryBytes;
    LIMITS.totalBytes = totalBytes;
  }
});
it("rejects too many ZIP entries and duplicate names", () => {
  expect(() =>
    read(fixture(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`entry${i}`, ""])))),
  ).toThrow("Too many Excel ZIP entries");
  const rename = (view: DataView, offset: number, name: string, at: number) => {
    if (name === "extra2") view.setUint8(offset + at + 5, "1".charCodeAt(0));
  };
  const duplicate = directoryEntries(
    localEntries(fixture({ extra1: "a", extra2: "b" }), (view, offset, name) =>
      rename(view, offset, name, 30),
    ),
    (view, offset, name) => rename(view, offset, name, 46),
  );
  expect(() => read(duplicate)).toThrow("Duplicate Excel ZIP entry");
});

it("exports filled formulas as Excel shared formulas when the first cell holds the formula", () => {
  const result = {
    sheetOrder: ["a"],
    sheets: {
      a: {
        name: "A",
        cellData: {
          0: { 1: { f: "=A1*2", si: "fill", v: 2, t: 2 }, 3: { si: "up", v: 1, t: 2 } },
          1: { 1: { si: "fill", v: 4, t: 2 }, 3: { f: "=C2", si: "up", v: 1, t: 2 } },
          2: { 1: { si: "fill", v: 6, t: 2 }, 2: { si: "orphan", v: 7, t: 2 } },
          5: null,
        },
      },
    },
  } as unknown as Snapshot;
  const xmlText = strFromU8(unzipSync(writeXlsx(result))["xl/worksheets/sheet1.xml"] as Uint8Array);
  expect(xmlText).toContain(
    '<c r="B1" s="0"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c>',
  );
  expect(xmlText).toContain('<c r="B3" s="0"><f t="shared" si="0"/><v>6</v></c>');
  // A group whose formula isn't in its first cell, or has no formula, keeps its values.
  expect(xmlText).toContain('<c r="D1" s="0"><v>1</v></c>');
  expect(xmlText).toContain('<c r="D2" s="0"><f>C2</f><v>1</v></c>');
  expect(xmlText).toContain('<c r="C3" s="0"><v>7</v></c>');
});

it("exports a freeze below scrolled rows and columns with the sheet view's top-left cell", () => {
  const freeze = (value: unknown) =>
    strFromU8(
      unzipSync(
        writeXlsx({
          sheetOrder: ["a"],
          sheets: { a: { name: "A", freeze: value } },
        } as unknown as Snapshot),
      )["xl/worksheets/sheet1.xml"] as Uint8Array,
    );
  expect(freeze({ xSplit: 1, ySplit: 2, startRow: 12, startColumn: 4 })).toContain(
    '<sheetView workbookViewId="0" topLeftCell="D11"><pane xSplit="1" ySplit="2" topLeftCell="E13" activePane="bottomRight" state="frozen"/></sheetView>',
  );
  expect(freeze({ xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 })).toContain(
    '<sheetView workbookViewId="0"><pane xSplit="0" ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>',
  );
  expect(freeze({ xSplit: 2, ySplit: 0, startRow: -1, startColumn: 2 })).toContain(
    'activePane="topRight"',
  );
  const round = read(
    writeXlsx({
      sheetOrder: ["a"],
      sheets: { a: { name: "A", freeze: { xSplit: 1, ySplit: 2, startRow: 12, startColumn: 4 } } },
    } as unknown as Snapshot),
  );
  expect(round.sheets.sheet1.freeze).toEqual({
    xSplit: 1,
    ySplit: 2,
    startRow: 12,
    startColumn: 4,
  });
});

it("exports text booleans, rich-text paragraphs and over-long text the way Excel reads them", () => {
  const data = read(
    writeXlsx({
      sheetOrder: ["a"],
      sheets: {
        a: {
          name: "A",
          cellData: {
            0: {
              0: { v: "TRUE", t: 3 },
              1: { v: "no", t: 3 },
              2: { p: { body: { dataStream: "one\rtwo\r\n" } } },
              3: { v: "x".repeat(40_000) },
            },
          },
        },
      },
    } as unknown as Snapshot),
  );
  const row = data.sheets.sheet1.cellData?.[0];
  expect(row?.[0]).toEqual({ v: 1, t: 3 });
  expect(row?.[1]).toEqual({ v: 0, t: 3 });
  expect(row?.[2]).toEqual({ v: "one\ntwo", t: 1 });
  expect(String(row?.[3]?.v)).toHaveLength(32_767);
});

it("strips Excel's future-function prefixes from imported formulas", () =>
  expect(
    cell('<c r="A1"><f>_xlfn.XLOOKUP(1,_xlws.FILTER(B:B,B:B&gt;0),C:C)</f><v>1</v></c>'),
  ).toEqual({
    v: 1,
    t: 2,
    f: "=XLOOKUP(1,FILTER(B:B,B:B>0),C:C)",
  }));

it("caps cell text counted per reference, merges and overlapping column ranges", () => {
  const { text, merges } = LIMITS;
  LIMITS.text = 10;
  LIMITS.merges = 1;
  try {
    // One shared string referenced by many cells counts once per cell.
    rejects(
      {
        "xl/sharedStrings.xml": `<sst xmlns="${MAIN}"><si><t>four</t></si></sst>`,
        "xl/worksheets/data.xml": cellsXml(
          '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>0</v></c>',
        ),
      },
      "text exceeds",
    );
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          '<mergeCells><mergeCell ref="A1:B1"/><mergeCell ref="A2:B2"/></mergeCells>',
        ),
      },
      "Too many merged",
    );
  } finally {
    LIMITS.text = text;
    LIMITS.merges = merges;
  }
  rejects(
    {
      "xl/worksheets/data.xml": worksheet(
        '<cols><col min="1" max="16384" width="9"/><col min="3" max="3" width="9"/></cols>',
      ),
    },
    "Overlapping Excel columns",
  );
});

it("reads column-only freezes and rejects frozen panes past the sheet limits", () => {
  expect(
    sheet(
      '<sheetViews><sheetView topLeftCell="C1"><pane state="frozen" xSplit="1"/></sheetView></sheetViews>',
    ).freeze,
  ).toEqual({ xSplit: 1, ySplit: 0, startRow: -1, startColumn: 3 });
  rejects(
    {
      "xl/worksheets/data.xml": worksheet(
        '<sheetViews><sheetView topLeftCell="A100000"><pane state="frozen" ySplit="5"/></sheetView></sheetViews>',
      ),
    },
    "frozen pane",
  );
  rejects(
    {
      "xl/worksheets/data.xml": worksheet(
        '<sheetViews><sheetView topLeftCell="XFD1"><pane state="frozen" xSplit="5"/></sheetView></sheetViews>',
      ),
    },
    "frozen pane",
  );
});

it("stops reading the parts after the first one over the limit", () => {
  const { entryBytes } = LIMITS;
  LIMITS.entryBytes = 40;
  try {
    expect(() => read()).toThrow("uncompressed size");
  } finally {
    LIMITS.entryBytes = entryBytes;
  }
});

it("reads each worksheet part once and counts row heights and merges as cells", () => {
  rejects(
    {
      "xl/workbook.xml": bookXml('<sheet name="A" r:id="r1"/><sheet name="B" r:id="r1"/>'),
    },
    "separate parts",
  );
  rejects(
    { "xl/worksheets/data.xml": worksheet('<sheetData><row r="2"/><row r="2"/></sheetData>') },
    "Duplicate Excel row",
  );
  const { cells } = LIMITS;
  LIMITS.cells = 2;
  try {
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          '<sheetData><row r="1" ht="20"/><row r="2" ht="20"/><row r="3" ht="20"/></sheetData>',
        ),
      },
      "Excel cell limit",
    );
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          '<mergeCells><mergeCell ref="A1:B1"/><mergeCell ref="A2:B2"/><mergeCell ref="A3:B3"/></mergeCells>',
        ),
      },
      "Excel cell limit",
    );
  } finally {
    LIMITS.cells = cells;
  }
});

it("skips one-cell merges and rejects overlapping merges", () => {
  expect(
    sheet(
      '<mergeCells><mergeCell ref="C3:C3"/><mergeCell ref="A1:B2"/><mergeCell ref="C1:D2"/><mergeCell ref="A5:A6"/></mergeCells>',
    ).mergeData,
  ).toEqual([
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 },
    { startRow: 4, endRow: 5, startColumn: 0, endColumn: 0 },
  ]);
  for (const second of ["B2:C3", "A1:A2", "A2:B2"])
    rejects(
      {
        "xl/worksheets/data.xml": worksheet(
          `<mergeCells><mergeCell ref="A1:B2"/><mergeCell ref="${second}"/></mergeCells>`,
        ),
      },
      "Overlapping Excel merged cells",
    );
});

it("reads only cells in sheetData rows, so nesting can't multiply the work", () => {
  const read = sheet(
    '<c r="C1"><v>3</v></c><sheetData><row r="1"><c r="A1"><v>1</v><c r="A2"><v>2</v></c></c></row><x><row r="5"><c r="A5"><v>5</v></c></row></x></sheetData>',
  );
  expect(read.cellData).toEqual({ 0: { 0: { v: 1, t: 2 } } });
  expect(read.rowCount).toBe(1);
});

it("writes each formula of a group with several formula cells as its own formula", () => {
  const xmlText = strFromU8(
    unzipSync(
      writeXlsx({
        sheetOrder: ["a"],
        sheets: {
          a: {
            name: "A",
            cellData: {
              0: { 0: { f: "=B1", si: "g", v: 1, t: 2 } },
              1: { 0: { f: "=C2", si: "g", v: 2, t: 2 } },
              2: { 0: { si: "g", v: 3, t: 2 } },
            },
          },
        },
      } as unknown as Snapshot),
    )["xl/worksheets/sheet1.xml"] as Uint8Array,
  );
  expect(xmlText).not.toContain('t="shared"');
  expect(xmlText).toContain('<c r="A2" s="0"><f>C2</f><v>2</v></c>');
  expect(xmlText).toContain('<c r="A3" s="0"><v>3</v></c>');
});

it("rejects a ZIP whose compressed data is corrupt", () => {
  const bytes = fixture({ "xl/worksheets/data.xml": worksheet(" ".repeat(2000)) });
  localEntries(bytes, (view, offset, name) => {
    if (name !== "xl/worksheets/data.xml") return;
    const start =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    for (let i = 0; i < 8; i++) view.setUint8(start + i, 0xff);
  });
  expect(() => read(bytes)).toThrow(XlsxImportError);
});

it("rejects an export with a missing sheet rather than silently dropping its data", () => {
  expect(() => writeXlsx({ sheetOrder: ["missing"], sheets: {} })).toThrow("Missing sheet data");
});

it("clamps row heights and column widths to Excel's maxima", () => {
  const big = sheet(
    '<cols><col min="1" max="1" width="1e308"/></cols><sheetData><row r="1" ht="1e308"/></sheetData>',
  );
  expect(big.rowData?.[0]?.h).toBeCloseTo((409 * 96) / 72);
  expect(big.columnData?.[0]?.w).toBe(255 * 7 + 5);
});

it("limits number formats, counts them per cell, and caps merges across the workbook", () => {
  rejects(
    {
      "xl/styles.xml": `<styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164" formatCode="${"0".repeat(256)}"/></numFmts></styleSheet>`,
    },
    "number format is too long",
  );
  const { text, merges } = LIMITS;
  LIMITS.text = 10;
  LIMITS.merges = 1;
  try {
    rejects(
      {
        "xl/styles.xml": `<styleSheet xmlns="${MAIN}"><numFmts><numFmt numFmtId="164" formatCode="0.000000"/></numFmts><cellXfs><xf/><xf numFmtId="164"/></cellXfs></styleSheet>`,
        "xl/worksheets/data.xml": cellsXml(
          '<c r="A1" s="1"><v>1</v></c><c r="B1" s="1"><v>1</v></c>',
        ),
      },
      "text exceeds",
    );
    const twoSheets = {
      "xl/workbook.xml": bookXml('<sheet name="A" r:id="r1"/><sheet name="B" r:id="r2"/>'),
      "xl/_rels/workbook.xml.rels": relsXml(
        `${relationship()}<Relationship Id="r2" Type="${REL}/worksheet" Target="worksheets/other.xml"/>`,
      ),
      "xl/worksheets/data.xml": worksheet('<mergeCells><mergeCell ref="A1:B1"/></mergeCells>'),
      "xl/worksheets/other.xml": worksheet('<mergeCells><mergeCell ref="A1:B1"/></mergeCells>'),
    };
    rejects(twoSheets, "Too many merged");
  } finally {
    LIMITS.text = text;
    LIMITS.merges = merges;
  }
});

it("makes imported sheet names valid and unique", () => {
  const result = read(
    fixture({
      "xl/workbook.xml": bookXml(
        `<sheet name="${"Long name ".repeat(5)}" r:id="r1"/><sheet name="Data" r:id="r2"/><sheet name="data" r:id="r3"/>`,
      ),
      "xl/_rels/workbook.xml.rels": relsXml(
        `${relationship()}<Relationship Id="r2" Type="${REL}/worksheet" Target="worksheets/b.xml"/><Relationship Id="r3" Type="${REL}/worksheet" Target="worksheets/c.xml"/>`,
      ),
      "xl/worksheets/b.xml": worksheet(),
      "xl/worksheets/c.xml": worksheet(),
    }),
  );
  expect(
    result.sheetOrder.map((id) => (result.sheets[id] as Partial<IWorksheetData>).name),
  ).toEqual(["Long name Long name Long name L", "Data", "data (2)"]);
});

it("cuts cached formula text to Excel's cell limit on export", () => {
  const xmlText = strFromU8(
    unzipSync(
      writeXlsx({
        sheetOrder: ["a"],
        sheets: {
          a: {
            name: "A",
            cellData: { 0: { 0: { f: '=REPT("x",40000)', v: "x".repeat(40_000) } } },
          },
        },
      } as unknown as Snapshot),
    )["xl/worksheets/sheet1.xml"] as Uint8Array,
  );
  expect(xmlText).toContain(`<v>${"x".repeat(32_767)}</v>`);
  expect(xmlText).not.toContain("x".repeat(32_768));
});

it("rejects a cell reference with an encoded trailing newline", () => {
  rejects({ "xl/worksheets/data.xml": cellsXml('<c r="A1&#10;"/>') }, "reference");
});

it("imports Excel shared formulas as one Univer formula group and round trips it", () => {
  const imported = sheet(
    '<sheetData><row r="1"><c r="B1"><f t="shared" ref="B1:B3" si="4">A1*2</f><v>2</v></c><c r="C1"><f t="shared" si="9"/><v>5</v></c></row><row r="2"><c r="B2"><f t="shared" si="4"/><v>4</v></c></row><row r="3"><c r="B3"><f t="shared" si="4"/><v>6</v></c></row><row r="4"><c r="B4"><f t="shared" si="4"/><v>8</v></c><c r="C4"><f t="shared" ref="C4:C5" si="4">A4</f><v>1</v></c></row></sheetData>',
  );
  const cells = imported.cellData ?? {};
  expect(cells[0]?.[1]).toEqual({ v: 2, t: 2, f: "=A1*2", si: "sheet1-f0" });
  expect(cells[1]?.[1]).toEqual({ v: 4, t: 2, si: "sheet1-f0" });
  expect(cells[2]?.[1]).toEqual({ v: 6, t: 2, si: "sheet1-f0" });
  // Outside the group's range, or naming an unknown group: the cached value only.
  expect(cells[3]?.[1]).toEqual({ v: 8, t: 2 });
  expect(cells[0]?.[2]).toEqual({ v: 5, t: 2 });
  // A second formula with a used group number is an ordinary formula.
  expect(cells[3]?.[2]).toEqual({ v: 1, t: 2, f: "=A4" });
  const xmlText = strFromU8(
    unzipSync(
      writeXlsx({ sheetOrder: ["sheet1"], sheets: { sheet1: imported } } as unknown as Snapshot),
    )["xl/worksheets/sheet1.xml"] as Uint8Array,
  );
  expect(xmlText).toContain('<f t="shared" ref="B1:B3" si="0">A1*2</f>');
  expect(xmlText).toContain('<c r="B3" s="0"><f t="shared" si="0"/><v>6</v></c>');
});

it("lets Univer spill array formulas instead of importing their cached results", () => {
  const imported = sheet(
    '<sheetData><row r="1"><c r="A1"><f t="array" ref="A1:B2">_xlfn.SEQUENCE(2,2)</f><v>1</v></c><c r="B1"><v>2</v></c><c r="D1"><f t="array" ref="D1">1</f><v>1</v></c><c r="E1"><f t="array" ref="E1:E2">F1:F2</f><v>0</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><f>A2</f><v>3</v></c><c r="E2"><f t="shared" si="1"/><v>0</v></c></row></sheetData>',
  );
  const cells = imported.cellData ?? {};
  expect(cells[0]?.[0]).toEqual({ v: 1, t: 2, f: "=SEQUENCE(2,2)" });
  expect(cells[0]?.[1]).toEqual({});
  expect(cells[1]?.[0]).toEqual({});
  // A cell holding its own formula keeps its value.
  expect(cells[1]?.[1]).toEqual({ v: 3, t: 2, f: "=A2" });
  // A one-cell array formula is an ordinary formula.
  expect(cells[0]?.[3]).toEqual({ v: 1, t: 2, f: "=1" });
  expect(cells[1]?.[4]).toEqual({});
  // Each covered cell counts towards the cell limit.
  const { cells: limit } = LIMITS;
  LIMITS.cells = 3;
  try {
    expect(() =>
      sheet(
        '<sheetData><row r="1"><c r="A1"><f t="array" ref="A1:A3">B1:B3</f><v>0</v></c></row></sheetData>',
      ),
    ).toThrow("cell limit");
  } finally {
    LIMITS.cells = limit;
  }
  expect(
    sheet('<sheetData><row r="1"><c r="A1"><f t="array" ref="A1:B2:C3">1</f></c></row></sheetData>')
      .cellData?.[0]?.[0],
  ).toEqual({ f: "=1" });
  expect(() =>
    sheet('<sheetData><row r="1"><c r="A1"><f t="array" ref="A0:B2">1</f></c></row></sheetData>'),
  ).toThrow(XlsxImportError);
  expect(
    sheet('<sheetData><row r="2"><c r="B2"><f t="array" ref="B2:A1">1</f></c></row></sheetData>')
      .cellData?.[1]?.[1],
  ).toEqual({ f: "=1" });
});

it("reads Excel's TRUE spelling of booleans", () => {
  expect(cell('<c r="A1" t="b"><v>TRUE</v></c>')).toEqual({ v: 1, t: 3 });
  expect(cell('<c r="A1" t="b"><v>false</v></c>')).toEqual({ v: 0, t: 3 });
});

it("keeps string literals and adds Excel's prefixes to newer functions on export", () => {
  expect(cell('<c r="A1"><f>"_xlfn.x"&amp;_xlfn.CONCAT("a""_xlws.",B1)</f></c>')).toEqual({
    f: '="_xlfn.x"&CONCAT("a""_xlws.",B1)',
  });
  const xmlText = strFromU8(
    unzipSync(
      writeXlsx({
        sheetOrder: ["a"],
        sheets: {
          a: {
            name: "A",
            cellData: {
              0: {
                0: {
                  f: '=xlookup(1,FILTER(B:B,B:B>0),sort(C:C))&"IFS(x)"&SUM(1)&_xlfn.IFS(1,2)&my.IFS(1)',
                },
                1: { f: "=STDEV.S(A:A)", si: "g" },
                2: { si: "g" },
              },
            },
          },
        },
      } as unknown as Snapshot),
    )["xl/worksheets/sheet1.xml"] as Uint8Array,
  );
  expect(xmlText).toContain(
    "<f>_xlfn.xlookup(1,_xlfn._xlws.FILTER(B:B,B:B&gt;0),_xlfn._xlws.sort(C:C))&amp;&quot;IFS(x)&quot;&amp;SUM(1)&amp;_xlfn.IFS(1,2)&amp;my.IFS(1)</f>",
  );
  expect(xmlText).toContain('<f t="shared" ref="B1:C1" si="0">_xlfn.STDEV.S(A:A)</f>');
});

it("keeps exported sizes, numbers and formats within Excel's limits", () => {
  const bytes = writeXlsx({
    sheetOrder: ["a"],
    sheets: {
      a: {
        name: "A",
        cellData: {
          0: {
            0: { v: Number.NaN, t: 2 },
            1: { v: Number.POSITIVE_INFINITY, t: 2 },
            2: { v: 1, t: 2, s: { n: { pattern: "0".repeat(256) } } },
          },
        },
        rowData: { 0: { h: 10_000 } },
        columnData: { 0: { w: 10_000 } },
      },
    },
  } as unknown as Snapshot);
  const files = unzipSync(bytes);
  const xmlText = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
  expect(xmlText).toContain('width="255"');
  expect(xmlText).toContain('ht="409"');
  expect(xmlText).toContain('<c r="A1" s="0"></c><c r="B1" s="0"></c><c r="C1" s="0"><v>1</v></c>');
  expect(strFromU8(files["xl/styles.xml"] as Uint8Array)).toContain('<numFmts count="0">');
});
