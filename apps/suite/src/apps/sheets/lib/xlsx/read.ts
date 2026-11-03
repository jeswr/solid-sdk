// AUTHORED-BY Codex GPT-6.1-Sol
import type { ICellData, IWorkbookData, IWorksheetData } from "@univerjs/core";
import { strFromU8, Unzip, UnzipInflate } from "fflate";
import type { Snapshot } from "../model/snapshot";
import {
  coordinate,
  elements,
  LIMITS,
  PACKAGE_REL,
  REL,
  requireXlsx,
  STRICT_REL,
  XlsxImportError,
} from "./common";

const BUILTIN_FORMATS = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

function targetPath(target: string): string {
  requireXlsx(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject package path controls
    !/[\\?#:%\u0000-\u0020]/u.test(target) && !target.startsWith("//") && target.length > 0,
    "Invalid Excel relationship target",
  );
  const parts = target.startsWith("/") ? [] : ["xl"];
  for (const part of target.split("/")) {
    if (part === "..")
      requireXlsx(parts.pop() !== undefined, "Excel relationship leaves the package");
    else if (part && part !== ".") {
      requireXlsx(
        !["__proto__", "constructor", "prototype"].includes(part),
        "Invalid Excel relationship target",
      );
      parts.push(part);
    }
  }
  requireXlsx(parts.length > 0, "Invalid Excel relationship target");
  return parts.join("/");
}

function parseXml(bytes: Uint8Array | undefined, name: string): Document {
  requireXlsx(bytes, `Excel file is missing ${name}`);
  // OOXML permits UTF-16 XML as well as UTF-8. Decode before checking for DTDs.
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
  const bigEndian =
    (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);
  const text =
    utf16 || bigEndian
      ? new TextDecoder(bigEndian ? "utf-16be" : "utf-16le").decode(bytes)
      : strFromU8(bytes);
  requireXlsx(!/<!DOCTYPE/i.test(text), "Excel XML must not contain a DOCTYPE");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  requireXlsx(doc.getElementsByTagNameNS("*", "parsererror").length === 0, "Invalid Excel XML");
  return doc;
}

function numberAttribute(element: Element, name: string, fallback: number): number {
  const value = element.getAttribute(name);
  const result = value === null ? fallback : Number(value);
  requireXlsx(Number.isFinite(result) && result >= 0, `Invalid Excel ${name}`);
  return result;
}

/** Plain text of a string item, without phonetic (furigana) runs. */
function richText(root: Element): string {
  return elements(root, "t")
    .filter((text) => text.parentElement?.localName !== "rPh")
    .map((text) => text.textContent)
    .join("");
}

function readSheet(
  doc: Document,
  id: string,
  name: string,
  strings: string[],
  formats: (string | undefined)[],
  countCell: () => void,
  countText: (length: number) => void,
): Partial<IWorksheetData> {
  const sheet: Partial<IWorksheetData> = {
    id,
    name,
    rowCount: 1,
    columnCount: 1,
    cellData: {},
    mergeData: [],
    rowData: {},
    columnData: {},
  };
  const cells = sheet.cellData as NonNullable<IWorksheetData["cellData"]>;
  const touch = (row: number, column: number) => {
    sheet.rowCount = Math.max(sheet.rowCount as number, row + 1);
    sheet.columnCount = Math.max(sheet.columnCount as number, column + 1);
  };
  const rows = new Set<number>();
  for (const row of elements(doc, "row")) {
    const r = numberAttribute(row, "r", 0);
    requireXlsx(Number.isInteger(r) && r > 0, "Invalid Excel row");
    requireXlsx(!rows.has(r), "Duplicate Excel row");
    rows.add(r);
    // Spreadsheet apps often write empty formatted rows to the sheet's end: skip those.
    if (r > LIMITS.rows && elements(row, "c").length === 0) continue;
    requireXlsx(r <= LIMITS.rows, "Excel row limit exceeded");
    if (row.hasAttribute("ht")) {
      const h = (numberAttribute(row, "ht", 0) * 96) / 72;
      requireXlsx(Number.isFinite(h), "Invalid Excel row height");
      // Row heights count towards the workbook's cell limit, like cells and merges.
      countCell();
      (sheet.rowData as IWorksheetData["rowData"])[r - 1] = { h };
    }
  }
  const widths: { min: number; max: number; w: number }[] = [];
  for (const col of elements(doc, "col")) {
    const min = numberAttribute(col, "min", 0);
    const max = numberAttribute(col, "max", 0);
    requireXlsx(
      Number.isInteger(min) &&
        Number.isInteger(max) &&
        min >= 1 &&
        max >= min &&
        max <= LIMITS.columns,
      "Excel column limit exceeded",
    );
    if (col.hasAttribute("width")) {
      const w = numberAttribute(col, "width", 0) * 7 + 5;
      requireXlsx(Number.isFinite(w), "Invalid Excel column width");
      widths.push({ min, max, w });
    }
  }
  for (const element of elements(doc, "c")) {
    countCell();
    const { row, column } = coordinate(element.getAttribute("r") ?? "");
    touch(row, column);
    const cell: ICellData = {};
    const value = elements(element, "v")[0]?.textContent;
    const formulaElement = elements(element, "f")[0];
    const type = element.getAttribute("t");
    if (type === "s") {
      const index = Number(value);
      requireXlsx(
        value != null && Number.isInteger(index) && index >= 0 && index < strings.length,
        "Invalid Excel shared string",
      );
      cell.v = strings[index];
      cell.t = 1;
    } else if (type === "inlineStr") {
      cell.v = richText(element);
      cell.t = 1;
    } else if (value != null) {
      if (type === "b") {
        cell.v = value === "1" ? 1 : 0;
        cell.t = 3;
      } else if (type === "str" || type === "e" || type === "d") {
        cell.v = value;
        cell.t = 1;
      } else if (value !== "" || !formulaElement) {
        requireXlsx(value.trim() !== "" && Number.isFinite(Number(value)), "Invalid Excel number");
        cell.v = Number(value);
        cell.t = 2;
      }
    }
    // Newer Excel functions are stored with a _xlfn./_xlws. prefix that Univer doesn't know.
    const formula = formulaElement?.textContent?.replace(/\b_xl(?:fn|ws)\./gi, "");
    if (formula) cell.f = `=${formula}`;
    countText((typeof cell.v === "string" ? cell.v.length : 0) + (formula?.length ?? 0));
    const style = numberAttribute(element, "s", 0);
    const pattern = formats[style];
    if (pattern && pattern !== "General") cell.s = { n: { pattern } };
    cells[row] ??= {};
    requireXlsx(!Object.hasOwn(cells[row], column), "Duplicate Excel cell reference");
    cells[row][column] = cell;
  }
  const merges = elements(doc, "mergeCell");
  requireXlsx(merges.length <= LIMITS.merges, "Too many merged Excel cells");
  const ranges: NonNullable<IWorksheetData["mergeData"]> = [];
  for (const merge of merges) {
    const refs = (merge.getAttribute("ref") ?? "").split(":");
    requireXlsx(refs.length === 2, "Invalid Excel merge range");
    const start = coordinate(refs[0] as string);
    const end = coordinate(refs[1] as string);
    requireXlsx(start.row <= end.row && start.column <= end.column, "Invalid Excel merge range");
    // A one-cell merge merges nothing.
    if (start.row === end.row && start.column === end.column) continue;
    countCell();
    touch(end.row, end.column);
    ranges.push({
      startRow: start.row,
      endRow: end.row,
      startColumn: start.column,
      endColumn: end.column,
    });
  }
  // Merged ranges may not overlap. Sorted by first row, each range is compared only with
  // the later ranges that start within its rows; the merge cap bounds the worst case.
  ranges.sort((a, b) => a.startRow - b.startRow);
  for (const [i, a] of ranges.entries())
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j] as (typeof ranges)[number];
      if (b.startRow > a.endRow) break;
      requireXlsx(
        b.startColumn > a.endColumn || b.endColumn < a.startColumn,
        "Overlapping Excel merged cells",
      );
    }
  sheet.mergeData = ranges;
  // Column definitions often run to the last Excel column; keep widths only for the
  // columns the sheet uses (at least A:Z), without growing the sheet.
  // Ranges may not overlap, so expanding them is bounded by the column count.
  widths.sort((a, b) => a.min - b.min);
  for (const [i, range] of widths.entries())
    requireXlsx(i === 0 || range.min > (widths[i - 1]?.max as number), "Overlapping Excel columns");
  const widthColumns = Math.max(sheet.columnCount as number, 26);
  for (const { min, max, w } of widths)
    for (let c = min - 1; c < Math.min(max, widthColumns); c++)
      (sheet.columnData as IWorksheetData["columnData"])[c] = { w };
  const pane = elements(doc, "pane")[0];
  if (
    pane &&
    (pane.getAttribute("state") === "frozen" || pane.getAttribute("state") === "frozenSplit")
  ) {
    const xSplit = numberAttribute(pane, "xSplit", 0);
    const ySplit = numberAttribute(pane, "ySplit", 0);
    requireXlsx(
      Number.isInteger(xSplit) &&
        Number.isInteger(ySplit) &&
        xSplit <= LIMITS.columns &&
        ySplit <= LIMITS.rows,
      "Invalid Excel frozen pane",
    );
    // Excel freezes the first ySplit rows and xSplit columns shown from the sheet view's
    // top-left cell; the pane's own topLeftCell is only where the scrolling pane is.
    // Univer marks the line after the frozen rows and columns (-1 when none are frozen).
    const view = elements(doc, "sheetView")[0]?.getAttribute("topLeftCell");
    const origin = view ? coordinate(view) : { row: 0, column: 0 };
    const startRow = ySplit > 0 ? origin.row + ySplit : -1;
    const startColumn = xSplit > 0 ? origin.column + xSplit : -1;
    requireXlsx(
      startRow <= LIMITS.rows && startColumn <= LIMITS.columns,
      "Invalid Excel frozen pane",
    );
    if (xSplit > 0 || ySplit > 0) sheet.freeze = { xSplit, ySplit, startRow, startColumn };
  }
  return sheet;
}

function relationshipId(sheet: Element): string {
  return sheet.getAttributeNS(REL, "id") ?? sheet.getAttributeNS(STRICT_REL, "id") ?? "";
}

/** Bytes of input fed to the inflater per step, which bounds the work done past a size limit. */
const CHUNK = 16 * 1024;

/**
 * Extract the wanted ZIP entries. The sizes a ZIP declares can't be trusted, so the
 * inflated bytes are counted as they arrive and extraction stops at the first entry that
 * exceeds the limits. Entries that aren't wanted are skipped without inflating them.
 */
function extract(
  data: Uint8Array,
  wanted: (name: string) => boolean,
  budget: { total: number },
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let failure: unknown;
  const unzip = new Unzip((file) => {
    try {
      requireXlsx(!names.has(file.name), "Duplicate Excel ZIP entry");
      names.add(file.name);
      requireXlsx(names.size <= LIMITS.entries, "Too many Excel ZIP entries");
      requireXlsx(
        !/vbaProject\.bin$/i.test(file.name),
        "Macro-enabled Excel files are not supported",
      );
      if (!wanted(file.name)) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, chunk, final) => {
        if (failure) return;
        try {
          if (error) throw error;
          size += chunk.length;
          budget.total += chunk.length;
          requireXlsx(
            size <= LIMITS.entryBytes && budget.total <= LIMITS.totalBytes,
            "Excel file exceeds the uncompressed size limit",
          );
          chunks.push(chunk);
          if (final) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
              bytes.set(part, offset);
              offset += part.length;
            }
            files.set(file.name, bytes);
          }
        } catch (caught) {
          failure = caught;
        }
      };
      file.start();
    } catch (caught) {
      failure ??= caught;
    }
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < data.length && !failure; offset += CHUNK)
    unzip.push(data.subarray(offset, offset + CHUNK), offset + CHUNK >= data.length);
  if (failure) throw failure;
  requireXlsx(names.size > 0, "Couldn't read this Excel file. Choose a valid .xlsx file.");
  return files;
}

export function readXlsx(data: Uint8Array, options: { title: string }): Snapshot {
  try {
    const metadata = new Set([
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/sharedStrings.xml",
    ]);
    const budget = { total: 0 };
    const parts = extract(data, (name) => metadata.has(name), budget);
    const content = parseXml(parts.get("[Content_Types].xml"), "content types");
    requireXlsx(
      ![...content.getElementsByTagNameNS("*", "Override")].some((part) =>
        /macroEnabled/i.test(part.getAttribute("ContentType") ?? ""),
      ),
      "Macro-enabled Excel files are not supported",
    );
    const workbook = parseXml(parts.get("xl/workbook.xml"), "workbook");
    const date1904 = elements(workbook, "workbookPr")[0]?.getAttribute("date1904");
    requireXlsx(
      date1904 !== "1" && date1904 !== "true",
      "Excel's 1904 date system is not supported",
    );
    const relationships = parseXml(
      parts.get("xl/_rels/workbook.xml.rels"),
      "workbook relationships",
    );
    const targets = new Map<string, string>();
    const relationshipIds = new Set<string>();
    for (const rel of relationships.getElementsByTagNameNS(PACKAGE_REL, "Relationship")) {
      const id = rel.getAttribute("Id") ?? "";
      requireXlsx(!relationshipIds.has(id), "Duplicate Excel relationship");
      relationshipIds.add(id);
      const type = rel.getAttribute("Type");
      if (type !== `${REL}/worksheet` && type !== `${STRICT_REL}/worksheet`) continue;
      requireXlsx(
        rel.getAttribute("TargetMode") !== "External",
        "External Excel worksheets are not supported",
      );
      targets.set(id, targetPath(rel.getAttribute("Target") ?? ""));
    }
    const sheets = elements(workbook, "sheet").filter((sheet) => {
      const id = relationshipId(sheet);
      requireXlsx(relationshipIds.has(id), "Missing Excel sheet relationship");
      return targets.has(id);
    });
    requireXlsx(
      sheets.length > 0 && sheets.length <= LIMITS.sheets,
      "Excel file must contain between 1 and 200 worksheets",
    );
    const needed = new Set(sheets.map((sheet) => targets.get(relationshipId(sheet)) as string));
    // Each worksheet part is read once: repeated references would multiply its cost.
    requireXlsx(needed.size === sheets.length, "Excel worksheets must be separate parts");
    const worksheets = extract(data, (name) => needed.has(name), budget);
    const strings = parts.get("xl/sharedStrings.xml")
      ? elements(parseXml(parts.get("xl/sharedStrings.xml"), "shared strings"), "si").map(richText)
      : [];
    const formats: (string | undefined)[] = [];
    if (parts.get("xl/styles.xml")) {
      const styles = parseXml(parts.get("xl/styles.xml"), "styles");
      const codes = new Map(BUILTIN_FORMATS);
      for (const format of elements(styles, "numFmt"))
        codes.set(
          Number(format.getAttribute("numFmtId")),
          format.getAttribute("formatCode") ?? "General",
        );
      const xfs = elements(styles, "cellXfs")[0];
      if (xfs)
        for (const xf of elements(xfs, "xf"))
          formats.push(codes.get(numberAttribute(xf, "numFmtId", 0)));
    }
    const snapshot = {
      id: "new",
      name: options.title,
      appVersion: "1.2.0",
      locale: "enUS",
      styles: {},
      sheetOrder: [] as string[],
      sheets: {},
    } as IWorkbookData;
    let cells = 0;
    let text = 0;
    let area = 0;
    for (const [i, sheet] of sheets.entries()) {
      const id = `sheet${i + 1}`;
      const path = targets.get(relationshipId(sheet)) as string;
      snapshot.sheetOrder.push(id);
      snapshot.sheets[id] = readSheet(
        parseXml(worksheets.get(path), path),
        id,
        sheet.getAttribute("name") ?? "Sheet",
        strings,
        formats,
        () => {
          requireXlsx(++cells <= LIMITS.cells, "Excel cell limit exceeded");
        },
        (length) => {
          text += length;
          requireXlsx(text <= LIMITS.text, "Excel text exceeds the size limit");
        },
      );
      area +=
        (snapshot.sheets[id].rowCount as number) * (snapshot.sheets[id].columnCount as number);
      requireXlsx(area <= LIMITS.cells, "Excel occupied grid exceeds the cell limit");
    }
    return snapshot as unknown as Snapshot;
  } catch (error) {
    if (error instanceof XlsxImportError) throw error;
    throw new XlsxImportError("Couldn't read this Excel file. Choose a valid .xlsx file.");
  }
}
