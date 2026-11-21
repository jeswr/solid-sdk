// AUTHORED-BY Codex GPT-6.1-Sol
import { CellValueType, type IWorkbookData } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import { openWithSheets } from "../src/apps/drive/lib/open-with/sheets";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

describe("Drive CSV import through WorkbookService", () => {
  it("matches Sheets import, preserves lexical text, creates a workbook and leaves the CSV unchanged", async () => {
    const h = await harness();
    const url = `${POD}drive/Accounts.csv`;
    const csv = 'ID,Formula,Label\r\n001,=1+1,"Quoted, text"\r\n';
    await h.pod.fetch(url, { method: "PUT", body: csv, headers: { "content-type": "text/csv" } });
    const before = await h.pod.fetch(url);
    h.calls.length = 0;
    const book = await openWithSheets(
      { url, name: "Accounts.csv", kind: "file" },
      { fetch: h.fetch, storageUrl: POD, webId: WEBID },
      h.service,
    );
    expect(book.metadata.title).toBe("Accounts");
    const snapshot = book.snapshot as unknown as IWorkbookData;
    expect(snapshot.sheets.sheet1?.cellData?.[1]).toEqual({
      0: { v: "001", t: CellValueType.STRING },
      1: { v: "=1+1", t: CellValueType.STRING },
      2: { v: "Quoted, text", t: CellValueType.STRING },
    });
    const reopened = await h.service.open(book.container);
    expect(reopened.snapshot).toEqual(book.snapshot);
    const after = await h.pod.fetch(url);
    expect(await after.text()).toBe(csv);
    expect(after.headers.get("etag")).toBe(before.headers.get("etag"));
    expect(h.calls.filter((call) => call.url === url).map((call) => call.method)).toEqual(["GET"]);
  });

  it("rejects malformed CSV through the same importer without leaving a workbook", async () => {
    const h = await harness();
    const url = `${POD}drive/Invalid.csv`;
    await h.pod.fetch(url, {
      method: "PUT",
      body: '"Unclosed',
      headers: { "content-type": "text/csv" },
    });
    await expect(
      openWithSheets(
        { url, name: "Invalid.csv", kind: "file" },
        { fetch: h.fetch, storageUrl: POD, webId: WEBID },
        h.service,
      ),
    ).rejects.toThrow("Unterminated CSV field");
    expect(await h.service.list()).toEqual([]);
    expect(await (await h.pod.fetch(url)).text()).toBe('"Unclosed');
  });
});
