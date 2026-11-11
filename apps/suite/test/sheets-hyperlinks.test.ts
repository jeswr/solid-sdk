// AUTHORED-BY Codex GPT-6.1-Sol
import { CustomRangeType, type ICellData } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import {
  cellLinkUrls,
  linkPlainText,
  presetLinkTarget,
  sanitizeCellLinks,
  sanitizeWorkbookLinks,
  validLink,
} from "../src/apps/sheets/lib/hyperlinks";
import type { Snapshot } from "../src/apps/sheets/lib/model/snapshot";
import { workbookToCsv } from "../src/apps/sheets/lib/univer-spike/workbook";
import { readXlsx, writeXlsx } from "../src/apps/sheets/lib/xlsx";
import { cellsXml, fixture, relsXml } from "./sheets-xlsx-fixtures";
import "./drive-ui-dom";

function linkedCell(url = "https://example.org/", label = "Example"): ICellData {
  return {
    t: 1,
    p: {
      id: "cell",
      documentStyle: {},
      body: {
        dataStream: `\u001f${label}\u001e\r\n`,
        paragraphs: [{ startIndex: label.length + 2, paragraphId: "paragraph" }],
        customRanges: [
          {
            rangeType: CustomRangeType.HYPERLINK,
            rangeId: "link",
            startIndex: 0,
            endIndex: label.length + 1,
            properties: { url },
          },
        ],
      },
    },
  };
}

function workbook(cell: ICellData): Snapshot {
  return {
    id: "book",
    sheetOrder: ["data"],
    sheets: {
      data: { id: "data", name: "Data", cellData: { 0: { 0: cell } } },
    },
  } as unknown as Snapshot;
}

describe("cell link policy shared with Docs", () => {
  it("repairs the preset form's mailto serialization before applying the existing policy", () => {
    for (const input of [
      "mailto:a@example.org",
      "mailto://a@example.org",
      "http://mailto:a@example.org",
      "http://mailto://a@example.org",
    ])
      expect(presetLinkTarget(input)).toBe("mailto:a@example.org");
    expect(presetLinkTarget("https://example.org/")).toBe("https://example.org/");
    expect(presetLinkTarget("javascript:alert(1)")).toBeNull();
    expect(presetLinkTarget("http://mailto:missing-address")).toBeNull();
  });
  it.each([
    "https://example.org/a?x=1#b",
    "http://example.org/",
    "mailto:reader@example.org",
    "https://suite.example/sheets/s/book",
    "https://suite.example/docs/d/doc",
  ])("accepts %s", (url) => expect(validLink(url)).toBe(url));

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.org/a",
    "//example.org/a",
    "https://user:password@example.org/",
    "java\nscript:alert(1)",
    "https://exa\tmple.org/",
    "mailto:missing-address",
    "",
  ])("refuses %s and flattens rich text without losing its label", (url) => {
    expect(validLink(url)).toBeNull();
    const cell = linkedCell(url);
    expect(sanitizeCellLinks(cell)).toEqual({ t: 1, v: "Example", p: null });
    expect(cell.p).toBeDefined();
    expect(cellLinkUrls(cell)).toEqual([]);
  });

  it("preserves allowed links and other ranges, strips legacy unsafe targets and tolerates blanks", () => {
    expect(sanitizeCellLinks(linkedCell())).toEqual(linkedCell());
    expect(sanitizeCellLinks({ linkUrl: "javascript:alert(1)", linkId: "old", v: "Old" })).toEqual({
      v: "Old",
    });
    const legacy = { linkUrl: "https://example.org/", linkId: "old", v: "Old" };
    expect(sanitizeCellLinks(legacy)).toEqual(legacy);
    expect(cellLinkUrls(legacy)).toEqual(["https://example.org/"]);
    const cell: ICellData = {
      p: {
        id: "plain",
        documentStyle: {},
        body: {
          dataStream: "Text\r\n",
          customRanges: [
            { rangeType: CustomRangeType.COMMENT, rangeId: "comment", startIndex: 0, endIndex: 3 },
            { rangeType: CustomRangeType.HYPERLINK, rangeId: "empty", startIndex: 0, endIndex: 3 },
          ],
        },
      },
    };
    expect(cellLinkUrls(cell)).toEqual([]);
    expect(sanitizeCellLinks(cell)).toEqual({ t: 1, v: "Text", p: null });
    cell.p?.body?.customRanges?.pop();
    expect(sanitizeCellLinks(cell)).toEqual(cell);
    expect(cellLinkUrls({ p: { id: "no-body", documentStyle: {} } })).toEqual([]);
    expect(linkPlainText("First\rSecond\r\n")).toBe("First\rSecond");
  });

  it("sanitizes snapshots without mutating stored data and tolerates empty sheets and cells", () => {
    const input = workbook(linkedCell("data:text/html,unsafe"));
    const safe = sanitizeWorkbookLinks(input);
    expect(JSON.stringify(safe)).not.toContain("data:text/html");
    expect(JSON.stringify(input)).toContain("data:text/html");
    expect(sanitizeWorkbookLinks({})).toEqual({});
    expect(
      sanitizeWorkbookLinks({ sheets: { empty: {}, blank: { cellData: { 0: { 0: null } } } } }),
    ).toEqual({ sheets: { empty: {}, blank: { cellData: { 0: { 0: null } } } } });
  });

  it("exports safe URLs as CSV text and unsafe targets as their visible label", () => {
    const data = workbook(linkedCell()) as unknown as Parameters<typeof workbookToCsv>[0];
    expect(workbookToCsv(data, "data")).toBe("https://example.org/\r\n");
    expect(
      workbookToCsv(workbook(linkedCell("javascript:alert(1)")) as unknown as typeof data, "data"),
    ).toBe("Example\r\n");
  });

  it("keeps the visible text on XLSX export and ignores imported hyperlink relationships", () => {
    vi.stubGlobal("DOMParser", window.DOMParser);
    const data = readXlsx(writeXlsx(workbook(linkedCell())), { title: "Links" });
    expect(JSON.stringify(data)).toContain("Example");
    expect(JSON.stringify(data)).not.toContain("example.org");
    for (const target of ["https://example.org/", "javascript:alert(1)", "data:text/html,bad"]) {
      const imported = readXlsx(
        fixture({
          "xl/worksheets/data.xml": cellsXml('<c r="A1" t="inlineStr"><is><t>Label</t></is></c>')
            .replace(
              "</worksheet>",
              '<hyperlinks><hyperlink ref="A1" r:id="h1"/></hyperlinks></worksheet>',
            )
            .replace(
              "<worksheet ",
              '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
            ),
          "xl/worksheets/_rels/data.xml.rels": relsXml(
            `<Relationship Id="h1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`,
          ),
        }),
        { title: "Imported links" },
      );
      expect(JSON.stringify(imported)).toContain("Label");
      expect(JSON.stringify(imported)).not.toContain(target);
    }
  });
});
