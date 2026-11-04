// AUTHORED-BY Codex GPT-6.1-Sol
import type { ICellData, IStyleData, IWorkbookData, IWorksheetData } from "@univerjs/core";
import { strToU8, zipSync } from "fflate";
import type { Snapshot } from "../model/snapshot";
import {
  cellRef,
  documentXml,
  MAIN,
  PACKAGE_REL,
  REL,
  sheetNames,
  toExcelFormula,
  xml,
} from "./common";

interface SharedFormula {
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly ref: string;
  readonly text: string;
}

/**
 * Univer stores a filled or copied formula once, on the first cell with an `si` id, and
 * gives the other cells only the id. Excel's shared formulas work the same way when that
 * cell is the top-left of the group, so those groups are written as shared formulas.
 * Other groups keep only their cached values.
 */
function sharedFormulas(cellData: NonNullable<IWorksheetData["cellData"]>) {
  const groups = new Map<
    string,
    {
      masters: number;
      row: number;
      column: number;
      text?: string;
      lastRow: number;
      lastColumn: number;
      firstRow: number;
      firstColumn: number;
    }
  >();
  for (const [r, cells] of Object.entries(cellData))
    for (const [c, cell] of Object.entries(cells ?? {}) as [string, ICellData | null][]) {
      if (!cell?.si) continue;
      const row = Number(r);
      const column = Number(c);
      const group = groups.get(cell.si) ?? {
        masters: 0,
        row: -1,
        column: -1,
        firstRow: row,
        firstColumn: column,
        lastRow: row,
        lastColumn: column,
      };
      group.firstRow = Math.min(group.firstRow, row);
      group.firstColumn = Math.min(group.firstColumn, column);
      group.lastRow = Math.max(group.lastRow, row);
      group.lastColumn = Math.max(group.lastColumn, column);
      if (cell.f) {
        group.masters += 1;
        group.text = toExcelFormula(cell.f);
        group.row = row;
        group.column = column;
      }
      groups.set(cell.si, group);
    }
  const result = new Map<string, SharedFormula>();
  // Univer reads a group with several formula cells differently, so only a group with one
  // formula, in its top-left cell, is shared.
  for (const [id, group] of groups)
    if (
      group.masters === 1 &&
      group.text &&
      group.row === group.firstRow &&
      group.column === group.firstColumn
    )
      result.set(id, {
        index: result.size,
        row: group.row,
        column: group.column,
        ref: `${cellRef(group.row, group.column)}:${cellRef(group.lastRow, group.lastColumn)}`,
        text: group.text,
      });
  return result;
}

/** Excel's sheet view for a Univer freeze: the frozen rows and columns start at its top-left cell. */
function sheetView(freeze: IWorksheetData["freeze"] | undefined): string {
  const ySplit = Math.max(0, freeze?.ySplit ?? 0);
  const xSplit = Math.max(0, freeze?.xSplit ?? 0);
  if (!freeze || (xSplit === 0 && ySplit === 0)) return '<sheetView workbookViewId="0"/>';
  const top = ySplit > 0 ? Math.max(0, freeze.startRow - ySplit) : 0;
  const left = xSplit > 0 ? Math.max(0, freeze.startColumn - xSplit) : 0;
  const activePane =
    ySplit > 0 && xSplit > 0 ? "bottomRight" : ySplit > 0 ? "bottomLeft" : "topRight";
  return `<sheetView workbookViewId="0"${top || left ? ` topLeftCell="${cellRef(top, left)}"` : ""}><pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${cellRef(top + ySplit, left + xSplit)}" activePane="${activePane}" state="frozen"/></sheetView>`;
}

/** Write the supported workbook subset without loading the spreadsheet engine. */
export function writeXlsx(snapshot: Snapshot): Uint8Array {
  const workbook = snapshot as unknown as IWorkbookData;
  const sheets = workbook.sheetOrder.map((id) => {
    const sheet = workbook.sheets[id];
    if (!sheet) throw new TypeError("Missing sheet data");
    return sheet;
  });
  const names = sheetNames(sheets.map((sheet) => sheet.name ?? "Sheet"));
  const patterns = new Map<string, number>();
  const parts: Record<string, Uint8Array> = {};
  const put = (name: string, body: string) => {
    parts[name] = strToU8(documentXml(body));
  };
  function styleId(cell: ICellData): number {
    const style = typeof cell.s === "string" ? workbook.styles?.[cell.s] : cell.s;
    const pattern = (style as IStyleData | undefined)?.n?.pattern;
    // Excel rejects number formats longer than 255 characters.
    if (!pattern || pattern.length > 255) return 0;
    let id = patterns.get(pattern);
    if (id === undefined) {
      id = patterns.size + 1;
      patterns.set(pattern, id);
    }
    return id;
  }
  function cellXml(
    cell: ICellData,
    row: number,
    column: number,
    shared: Map<string, SharedFormula>,
  ): string {
    const style = styleId(cell);
    const group = cell.si ? shared.get(cell.si) : undefined;
    let formula = "";
    if (group && group.row === row && group.column === column)
      formula = `<f t="shared" ref="${group.ref}" si="${group.index}">${xml(group.text)}</f>`;
    else if (group) formula = `<f t="shared" si="${group.index}"/>`;
    else if (cell.f) formula = `<f>${xml(toExcelFormula(cell.f))}</f>`;
    let value = cell.v;
    // Univer rich text ends with "\r\n" and separates paragraphs with "\r".
    if (cell.p?.body) value = cell.p.body.dataStream.replace(/\r\n$/, "").replace(/\r/g, "\n");
    let type = "";
    let body = "";
    if (value != null) {
      if (cell.t === 3 || typeof value === "boolean") {
        type = ' t="b"';
        const truthy = value === true || value === 1 || /^(?:1|true)$/i.test(String(value));
        body = `<v>${truthy ? 1 : 0}</v>`;
      } else if (typeof value === "number") {
        // Excel has no NaN or infinity; such a cell is written empty.
        if (Number.isFinite(value)) body = `<v>${value}</v>`;
      } else if (cell.t === 2 && String(value).trim() !== "" && Number.isFinite(Number(value)))
        body = `<v>${Number(value)}</v>`;
      else if (formula) {
        type = ' t="str"';
        body = `<v>${xml(String(value).slice(0, 32_767))}</v>`;
      } else {
        type = ' t="inlineStr"';
        // Excel's cell text limit.
        body = `<is><t xml:space="preserve">${xml(String(value).slice(0, 32_767))}</t></is>`;
      }
    }
    return `<c r="${cellRef(row, column)}" s="${style}"${type}>${formula}${body}</c>`;
  }
  for (const [index, sheet] of sheets.entries()) {
    const shared = sharedFormulas(sheet.cellData ?? {});
    const columns = Object.entries(sheet.columnData ?? {})
      .filter(([, col]) => col.w != null)
      .map(
        ([c, col]) =>
          `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${Math.min(255, Math.max(0, ((col.w as number) - 5) / 7))}" customWidth="1"/>`,
      )
      .join("");
    const rowIndices = new Set([
      ...Object.keys(sheet.cellData ?? {}),
      ...Object.keys(sheet.rowData ?? {}),
    ]);
    const rows = [...rowIndices]
      .sort((a, b) => Number(a) - Number(b))
      .map((r) => {
        const height = sheet.rowData?.[Number(r)]?.h;
        const cells = Object.entries(sheet.cellData?.[Number(r)] ?? {})
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([c, cell]) => cellXml(cell, Number(r), Number(c), shared))
          .join("");
        return `<row r="${Number(r) + 1}"${height == null ? "" : ` ht="${Math.min(409, (height * 72) / 96)}" customHeight="1"`}>${cells}</row>`;
      })
      .join("");
    const merges = (sheet.mergeData ?? [])
      .map(
        (range) =>
          `<mergeCell ref="${cellRef(range.startRow, range.startColumn)}:${cellRef(range.endRow, range.endColumn)}"/>`,
      )
      .join("");
    const view = sheetView(sheet.freeze);
    put(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${MAIN}"><sheetViews>${view}</sheetViews>${columns ? `<cols>${columns}</cols>` : ""}<sheetData>${rows}</sheetData>${merges ? `<mergeCells>${merges}</mergeCells>` : ""}</worksheet>`,
    );
  }
  put(
    "xl/styles.xml",
    `<styleSheet xmlns="${MAIN}"><numFmts count="${patterns.size}">${[...patterns].map(([pattern, id]) => `<numFmt numFmtId="${163 + id}" formatCode="${xml(pattern)}"/>`).join("")}</numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${patterns.size + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${[...patterns.values()].map((id) => `<xf numFmtId="${163 + id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  put(
    "xl/workbook.xml",
    `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
  );
  put(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  put(
    "_rels/.rels",
    `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="workbook" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  put(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  return zipSync(parts);
}
