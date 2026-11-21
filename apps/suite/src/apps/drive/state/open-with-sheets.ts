// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { workbookHref } from "../../sheets/lib/routes";
import { openWithSheets, openWithSheetsState, probeSheetsWritable } from "../lib/open-with/sheets";
import { createOpenWithController, type OpenWithControl } from "./open-with";

export type OpenWithSheetsControl = OpenWithControl;

export const { useOpenWith: useOpenWithSheets } = createOpenWithController({
  name: "Sheets",
  state: (item, { writable, ...context }) =>
    openWithSheetsState(item, { ...context, sheetsWritable: writable }),
  probeWritable: probeSheetsWritable,
  async convert(item, session) {
    const { createWorkbookService } = await import("../../sheets/lib/workbook");
    const service = createWorkbookService({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    });
    // The importer rechecks Write before downloading or creating a workbook.
    const book = await openWithSheets(item, session, service);
    return { url: book.container, href: workbookHref(book.container) };
  },
});
