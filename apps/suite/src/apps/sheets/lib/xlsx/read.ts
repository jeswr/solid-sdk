// AUTHORED-BY Codex GPT-6.1-Sol
import type { ICellData, IWorkbookData, IWorksheetData } from "@univerjs/core";
import { strFromU8, Unzip, UnzipInflate } from "fflate";
import type { Snapshot } from "../model/snapshot";
import {
  children,
  coordinate,
  elements,
  fromExcelFormula,
  LIMITS,
  PACKAGE_REL,
  REL,
  requireXlsx,
  STRICT_REL,
  sheetNames,
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
  [14, "m/d/yyyy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yyyy h:mm"],
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

function targetPath(target: string, source: string): string {
  requireXlsx(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject package path controls
    !/[\\?#:%\u0000-\u0020]/u.test(target) && !target.startsWith("//") && target.length > 0,
    "Invalid Excel relationship target",
  );
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
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
  let elements = 0;
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === 60) {
      elements++;
      requireXlsx(elements <= LIMITS.elements, "This Excel file is too complex");
    }
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

interface Range {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  anchorRow?: number;
  anchorColumn?: number;
}

/** A1 or A1:B2 as a range; undefined for more than two corners or an inverted range. */
function rangeOf(ref: string): Range | undefined {
  const refs = ref.split(":");
  if (refs.length > 2) return undefined;
  const start = coordinate(refs[0] as string);
  const end = coordinate((refs[1] ?? refs[0]) as string);
  if (end.row < start.row || end.column < start.column) return undefined;
  return { startRow: start.row, endRow: end.row, startColumn: start.column, endColumn: end.column };
}

function area(range: Range): number {
  return (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
}

function inside(range: Range, row: number, column: number): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  );
}

function readSheet(
  doc: Document,
  id: string,
  name: string,
  strings: string[],
  formats: (string | undefined)[],
  countCell: (count?: number) => void,
  countMerges: (count: number) => void,
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
  // Shared formulas by Excel `si`: the Univer id and the range the group may cover.
  const shared = new Map<string, { id: string; range: Range }>();
  const arrays: Range[] = [];
  const rows = new Set<number>();
  const rowNumbers = new Map<Element, number>();
  let previousRow = 0;
  for (const row of children(doc, "sheetData", "row")) {
    const r = numberAttribute(row, "r", previousRow + 1);
    previousRow = r;
    rowNumbers.set(row, r);
    requireXlsx(Number.isInteger(r) && r > 0, "Invalid Excel row");
    requireXlsx(!rows.has(r), "Duplicate Excel row");
    rows.add(r);
    // Spreadsheet apps often write empty formatted rows to the sheet's end: skip those.
    if (r > LIMITS.rows && children(row, "c").length === 0) continue;
    requireXlsx(r <= LIMITS.rows, "Excel row limit exceeded");
    if (row.hasAttribute("ht")) {
      // Excel's tallest row is 409 points.
      const h = (Math.min(numberAttribute(row, "ht", 0), 409) * 96) / 72;
      requireXlsx(Number.isFinite(h), "Invalid Excel row height");
      // Row heights count towards the workbook's cell limit, like cells and merges.
      countCell();
      (sheet.rowData as IWorksheetData["rowData"])[r - 1] = { h };
    }
  }
  const widths: { min: number; max: number; w: number }[] = [];
  for (const col of children(doc, "cols", "col")) {
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
      // Excel's widest column is 255 characters.
      const w = Math.min(numberAttribute(col, "width", 0), 255) * 7 + 5;
      requireXlsx(Number.isFinite(w), "Invalid Excel column width");
      widths.push({ min, max, w });
    }
  }
  for (const [rowElement, r] of rowNumbers) {
    let previousColumn = -1;
    for (const element of children(rowElement, "c")) {
      countCell();
      const ref = element.getAttribute("r");
      const { row, column } =
        ref === null ? { row: r - 1, column: previousColumn + 1 } : coordinate(ref);
      previousColumn = column;
      requireXlsx(column < LIMITS.columns, "Excel row or column limit exceeded");
      touch(row, column);
      const cell: ICellData = {};
      const value = children(element, "v")[0]?.textContent;
      const formulaElement = children(element, "f")[0];
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
          cell.v = /^(?:1|true)$/i.test(value.trim()) ? 1 : 0;
          cell.t = 3;
        } else if (type === "str" || type === "e" || type === "d") {
          cell.v = value;
          cell.t = 1;
        } else if (value !== "") {
          requireXlsx(
            value.trim() !== "" && Number.isFinite(Number(value)),
            "Invalid Excel number",
          );
          cell.v = Number(value);
          cell.t = 2;
        }
      }
      const formula = fromExcelFormula(formulaElement?.textContent ?? "");
      const kind = formulaElement?.getAttribute("t");
      const group = formulaElement?.getAttribute("si") ?? "";
      if (formula) {
        cell.f = `=${formula}`;
        const ref = formulaElement?.getAttribute("ref");
        const range = ref ? rangeOf(ref) : undefined;
        // A shared formula's first cell holds the text; Univer gives the group one id.
        if (kind === "shared" && range && !shared.has(group)) {
          const sharedId = `${id}-f${shared.size}`;
          shared.set(group, { id: sharedId, range });
          cell.si = sharedId;
        }
        // An array formula's other cells hold cached results. Univer spills the formula
        // into them itself, and refuses to spill over values, so those are dropped below.
        if (kind === "array" && range && area(range) > 1) {
          countCell(area(range));
          arrays.push({ ...range, anchorRow: row, anchorColumn: column });
        }
      } else if (kind === "shared") {
        // The other cells of a shared formula. Excel's group always starts at the first
        // cell; a cell outside it keeps only its cached value.
        const owner = shared.get(group);
        if (owner && inside(owner.range, row, column)) cell.si = owner.id;
      }
      const style = numberAttribute(element, "s", 0);
      const pattern = formats[style];
      if (pattern && pattern !== "General") cell.s = { n: { pattern } };
      // Each cell carries its own copy of strings and formats in the snapshot, so count them all.
      countText(
        (typeof cell.v === "string" ? cell.v.length : 0) +
          formula.length +
          (cell.s ? (pattern as string).length : 0),
      );
      cells[row] ??= {};
      requireXlsx(!Object.hasOwn(cells[row], column), "Duplicate Excel cell reference");
      cells[row][column] = cell;
    }
  }
  for (const range of arrays)
    for (let r = range.startRow; r <= range.endRow; r++)
      for (let c = range.startColumn; c <= range.endColumn; c++) {
        const cell = cells[r]?.[c];
        if (!cell || cell.f || cell.si || (r === range.anchorRow && c === range.anchorColumn))
          continue;
        delete cell.v;
        delete cell.t;
      }
  const merges = children(doc, "mergeCells", "mergeCell");
  countMerges(merges.length);
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
  const sheetView = children(doc, "sheetViews", "sheetView")[0];
  const pane = sheetView && children(sheetView, "pane")[0];
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
    const view = sheetView.getAttribute("topLeftCell");
    const origin = view ? coordinate(view) : { row: 0, column: 0 };
    const startRow = ySplit > 0 ? origin.row + ySplit : -1;
    const startColumn = xSplit > 0 ? origin.column + xSplit : -1;
    requireXlsx(
      startRow <= LIMITS.rows && startColumn <= LIMITS.columns,
      "Invalid Excel frozen pane",
    );
    if (xSplit > 0 || ySplit > 0) {
      // The sheet reaches at least as far as its frozen rows and columns.
      touch(Math.max(0, startRow - 1), Math.max(0, startColumn - 1));
      sheet.freeze = { xSplit, ySplit, startRow, startColumn };
    }
  }
  return sheet;
}

function relationshipId(sheet: Element): string {
  return sheet.getAttributeNS(REL, "id") ?? sheet.getAttributeNS(STRICT_REL, "id") ?? "";
}

function hasRelationshipType(rel: Element, kind: string): boolean {
  const type = rel.getAttribute("Type");
  return type === `${REL}/${kind}` || type === `${STRICT_REL}/${kind}`;
}

function readRelationships(bytes: Uint8Array | undefined, name: string): Map<string, Element> {
  const relationships = new Map<string, Element>();
  for (const rel of parseXml(bytes, name).getElementsByTagNameNS(PACKAGE_REL, "Relationship")) {
    const id = rel.getAttribute("Id") ?? "";
    requireXlsx(!relationships.has(id), "Duplicate Excel relationship");
    relationships.set(id, rel);
  }
  return relationships;
}

function relationshipTarget(rel: Element, source: string): string {
  requireXlsx(
    rel.getAttribute("TargetMode") !== "External",
    "External Excel relationships are not supported",
  );
  return targetPath(rel.getAttribute("Target") ?? "", source);
}

function resolvePart(
  relationships: Map<string, Element>,
  kind: string,
  source: string,
  conventional: string,
  names: Set<string>,
): string | undefined {
  const rel = [...relationships.values()].find((rel) => hasRelationshipType(rel, kind));
  if (!rel) return names.has(conventional) ? conventional : undefined;
  const path = relationshipTarget(rel, source);
  requireXlsx(names.has(path), `Excel file is missing ${path}`);
  return path;
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
): { files: Map<string, Uint8Array>; names: Set<string> } {
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
  return { files, names };
}

export function readXlsx(data: Uint8Array, options: { title: string }): Snapshot {
  try {
    requireXlsx(data.byteLength <= LIMITS.compressedBytes, "Excel files must be 50 MiB or smaller");
    const budget = { total: 0 };
    const { files: parts, names: entryNames } = extract(
      data,
      (name) => name === "[Content_Types].xml" || name === "_rels/.rels",
      budget,
    );
    // Resolve each stage before inflating its parts. A part shared by stages is counted once.
    const loadParts = (wanted: Set<string>) => {
      const next = extract(data, (name) => wanted.has(name) && !parts.has(name), budget);
      for (const [name, bytes] of next.files) parts.set(name, bytes);
    };
    const content = parseXml(parts.get("[Content_Types].xml"), "content types");
    requireXlsx(
      ![...content.getElementsByTagNameNS("*", "Override")].some((part) =>
        /macroEnabled/i.test(part.getAttribute("ContentType") ?? ""),
      ),
      "Macro-enabled Excel files are not supported",
    );
    const rootRelationships = parts.has("_rels/.rels")
      ? readRelationships(parts.get("_rels/.rels"), "package relationships")
      : new Map<string, Element>();
    const workbookPath = resolvePart(
      rootRelationships,
      "officeDocument",
      "",
      "xl/workbook.xml",
      entryNames,
    );
    requireXlsx(workbookPath, "Excel file is missing workbook");
    const slash = workbookPath.lastIndexOf("/");
    const workbookRelsPath = `${workbookPath.slice(0, slash + 1)}_rels/${workbookPath.slice(slash + 1)}.rels`;
    loadParts(new Set([workbookPath, workbookRelsPath]));
    const workbook = parseXml(parts.get(workbookPath), "workbook");
    const date1904 = children(workbook, "workbookPr")[0]?.getAttribute("date1904");
    requireXlsx(
      date1904 !== "1" && date1904 !== "true",
      "Excel's 1904 date system is not supported",
    );
    const relationships = readRelationships(parts.get(workbookRelsPath), "workbook relationships");
    const stringsPath = resolvePart(
      relationships,
      "sharedStrings",
      workbookPath,
      "xl/sharedStrings.xml",
      entryNames,
    );
    const stylesPath = resolvePart(
      relationships,
      "styles",
      workbookPath,
      "xl/styles.xml",
      entryNames,
    );
    const targets = new Map<string, string>();
    for (const [id, rel] of relationships) {
      if (hasRelationshipType(rel, "worksheet"))
        targets.set(id, relationshipTarget(rel, workbookPath));
    }
    const sheets = children(workbook, "sheets", "sheet").filter((sheet) => {
      const id = relationshipId(sheet);
      requireXlsx(relationships.has(id), "Missing Excel sheet relationship");
      return targets.has(id);
    });
    requireXlsx(
      sheets.length > 0 && sheets.length <= LIMITS.sheets,
      "Excel file must contain between 1 and 200 worksheets",
    );
    const needed = new Set(sheets.map((sheet) => targets.get(relationshipId(sheet)) as string));
    // Each worksheet part is read once: repeated references would multiply its cost.
    requireXlsx(needed.size === sheets.length, "Excel worksheets must be separate parts");
    if (stringsPath) needed.add(stringsPath);
    if (stylesPath) needed.add(stylesPath);
    loadParts(needed);
    const strings = stringsPath
      ? children(parseXml(parts.get(stringsPath), "shared strings"), "si").map(richText)
      : [];
    const formats: (string | undefined)[] = [];
    if (stylesPath) {
      const styles = parseXml(parts.get(stylesPath), "styles");
      const codes = new Map(BUILTIN_FORMATS);
      for (const format of children(styles, "numFmts", "numFmt")) {
        const code = format.getAttribute("formatCode") ?? "General";
        requireXlsx(code.length <= 255, "Excel number format is too long");
        codes.set(Number(format.getAttribute("numFmtId")), code);
      }
      for (const xf of children(styles, "cellXfs", "xf"))
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
    let merged = 0;
    let text = 0;
    let area = 0;
    // Names are made valid and unique the way Excel requires.
    const names = sheetNames(sheets.map((sheet) => sheet.getAttribute("name") ?? "Sheet"));
    for (const [i, sheet] of sheets.entries()) {
      const id = `sheet${i + 1}`;
      const path = targets.get(relationshipId(sheet)) as string;
      snapshot.sheetOrder.push(id);
      snapshot.sheets[id] = readSheet(
        parseXml(parts.get(path), path),
        id,
        names[i] as string,
        strings,
        formats,
        (count = 1) => {
          cells += count;
          requireXlsx(cells <= LIMITS.cells, "Excel cell limit exceeded");
        },
        (count) => {
          merged += count;
          // The overlap check compares merges pairwise, so the limit is for the workbook.
          requireXlsx(merged <= LIMITS.merges, "Too many merged Excel cells");
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
