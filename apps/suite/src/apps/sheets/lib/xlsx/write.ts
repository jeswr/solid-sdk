// AUTHORED-BY Codex GPT-6.1-Sol
import type { ICellData, IStyleData, IWorkbookData } from "@univerjs/core";
import { strToU8, zipSync } from "fflate";
import type { Snapshot } from "../model/snapshot";
import { cellRef, documentXml, MAIN, PACKAGE_REL, REL, sheetNames, xml } from "./common";

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
    if (!pattern) return 0;
    let id = patterns.get(pattern);
    if (id === undefined) {
      id = patterns.size + 1;
      patterns.set(pattern, id);
    }
    return id;
  }
  function cellXml(cell: ICellData, row: number, column: number): string {
    const style = styleId(cell);
    const formula = cell.f ? `<f>${xml(cell.f.replace(/^=/, ""))}</f>` : "";
    let value = cell.v;
    if (cell.p?.body) value = cell.p.body.dataStream.replace(/\r\n$/, "");
    let type = "";
    let body = "";
    if (value != null) {
      if (cell.t === 3 || typeof value === "boolean") {
        type = ' t="b"';
        body = `<v>${value === true || value === 1 || value === "1" ? 1 : 0}</v>`;
      } else if (typeof value === "number") body = `<v>${value}</v>`;
      else if (cell.t === 2 && String(value).trim() !== "" && Number.isFinite(Number(value)))
        body = `<v>${Number(value)}</v>`;
      else if (formula) {
        type = ' t="str"';
        body = `<v>${xml(String(value))}</v>`;
      } else {
        type = ' t="inlineStr"';
        body = `<is><t xml:space="preserve">${xml(String(value))}</t></is>`;
      }
    }
    return `<c r="${cellRef(row, column)}" s="${style}"${type}>${formula}${body}</c>`;
  }
  for (const [index, sheet] of sheets.entries()) {
    const columns = Object.entries(sheet.columnData ?? {})
      .filter(([, col]) => col.w != null)
      .map(
        ([c, col]) =>
          `<col min="${Number(c) + 1}" max="${Number(c) + 1}" width="${Math.max(0, ((col.w as number) - 5) / 7)}" customWidth="1"/>`,
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
          .map(([c, cell]) => cellXml(cell, Number(r), Number(c)))
          .join("");
        return `<row r="${Number(r) + 1}"${height == null ? "" : ` ht="${(height * 72) / 96}" customHeight="1"`}>${cells}</row>`;
      })
      .join("");
    const merges = (sheet.mergeData ?? [])
      .map(
        (range) =>
          `<mergeCell ref="${cellRef(range.startRow, range.startColumn)}:${cellRef(range.endRow, range.endColumn)}"/>`,
      )
      .join("");
    const freeze = sheet.freeze;
    const pane =
      freeze && (freeze.xSplit > 0 || freeze.ySplit > 0)
        ? `<pane xSplit="${freeze.xSplit}" ySplit="${freeze.ySplit}" topLeftCell="${cellRef(Math.max(freeze.ySplit, freeze.startRow), Math.max(freeze.xSplit, freeze.startColumn))}" state="frozen"/>`
        : "";
    put(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${columns ? `<cols>${columns}</cols>` : ""}<sheetData>${rows}</sheetData>${merges ? `<mergeCells>${merges}</mergeCells>` : ""}</worksheet>`,
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
