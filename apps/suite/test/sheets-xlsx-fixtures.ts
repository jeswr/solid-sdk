// AUTHORED-BY Codex GPT-6.1-Sol
import { strToU8, zipSync } from "fflate";
import { MAIN, PACKAGE_REL, REL } from "../src/apps/sheets/lib/xlsx/common";

export const worksheet = (body = "") => `<worksheet xmlns="${MAIN}">${body}</worksheet>`;
export const relationship = (target = "worksheets/data.xml", extra = "") =>
  `<Relationship Id="r1" Type="${REL}/worksheet" Target="${target}" ${extra}/>`;
export const bookXml = (sheets = '<sheet name="Data" sheetId="99" r:id="r1"/>', extra = "") =>
  `<workbook xmlns="${MAIN}" xmlns:r="${REL}">${extra}<sheets>${sheets}</sheets></workbook>`;
export const relsXml = (rels = relationship()) =>
  `<Relationships xmlns="${PACKAGE_REL}">${rels}</Relationships>`;
export function fixture(overrides: Record<string, string | Uint8Array | null> = {}): Uint8Array {
  const files: Record<string, string | Uint8Array | null> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": bookXml(),
    "xl/_rels/workbook.xml.rels": relsXml(),
    "xl/worksheets/data.xml": worksheet(),
    ...overrides,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files)
        .filter(([, value]) => value !== null)
        .map(([name, value]) => [
          name,
          typeof value === "string" ? strToU8(value) : (value as Uint8Array),
        ]),
    ),
  );
}
export const cellsXml = (cells: string) =>
  worksheet(`<sheetData><row r="1">${cells}</row></sheetData>`);
