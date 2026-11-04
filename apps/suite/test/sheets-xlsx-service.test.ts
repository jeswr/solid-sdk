// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import "./drive-ui-dom";
import { REL } from "../src/apps/sheets/lib/xlsx/common";
import { harness } from "./sheets-workbook-helpers";
import { bookXml, cellsXml, fixture, relationship, relsXml } from "./sheets-xlsx-fixtures";

it("creates and persists an imported Excel snapshot with every worksheet in order", async () => {
  vi.stubGlobal("DOMParser", window.DOMParser);
  const h = await harness();
  const data = fixture({
    "xl/workbook.xml": bookXml('<sheet name="First" r:id="r2"/><sheet name="Second" r:id="r1"/>'),
    "xl/_rels/workbook.xml.rels": relsXml(
      `${relationship()}<Relationship Id="r2" Type="${REL}/worksheet" Target="worksheets/first.xml"/>`,
    ),
    "xl/worksheets/first.xml": cellsXml('<c r="A1"><f>1+1</f><v>2</v></c>'),
  });
  const book = await h.service.createFromXlsx({ title: "Excel import", data });
  expect(book.metadata.title).toBe("Excel import");
  expect(book.metadata.sheets).toEqual([
    { number: 1, name: "First" },
    { number: 2, name: "Second" },
  ]);
  expect(book.snapshot.sheets).toMatchObject({
    sheet1: { rowCount: 1000, columnCount: 26, cellData: { 0: { 0: { f: "=1+1", v: 2 } } } },
  });
  expect((await h.service.open(book.container)).snapshot).toEqual(book.snapshot);
  await expect(
    h.service.createFromXlsx({ title: "Invalid", data: new Uint8Array([0]) }),
  ).rejects.toMatchObject({ name: "XlsxImportError" });
});
