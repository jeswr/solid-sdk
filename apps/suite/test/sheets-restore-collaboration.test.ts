// @vitest-environment jsdom
// AUTHORED-BY Claude Sonnet 5.5
import { expect, it } from "vitest";
import { cells, LOCAL_ORIGIN, sheetStates } from "../src/apps/sheets/lib/collaboration/model";
import type { WorkbookCollaboration } from "../src/apps/sheets/lib/collaboration/persistence";
import type { Snapshot } from "../src/apps/sheets/lib/contract";
import { harness } from "./sheets-workbook-helpers";

const base: Snapshot = {
  id: "ignored",
  sheetOrder: ["data"],
  styles: {},
  sheets: {
    data: {
      id: "data",
      name: "Data",
      rowCount: 3,
      columnCount: 2,
      cellData: { 0: { 0: { v: "Yesterday" } } },
    },
  },
};

function edit(runtime: WorkbookCollaboration, value: string) {
  const state = sheetStates(runtime.doc).get("data");
  const key = [...cells(state as NonNullable<typeof state>).keys()][0] as string;
  runtime.doc.transact(
    () => cells(state as NonNullable<typeof state>).set(key, { v: value }),
    LOCAL_ORIGIN,
  );
}
const text = (runtime: WorkbookCollaboration) => JSON.stringify(sheetStates(runtime.doc).toJSON());

it("restoring over a non-empty log starts a fresh log seeded from the version, so the restored cells survive reopen", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Restore", snapshot: base });
  const yesterday = book.snapshot;
  const first = (await h.service.collaborate?.(
    book.container,
    yesterday,
    false,
  )) as WorkbookCollaboration;
  edit(first, "Today");
  await first.flush();
  // Control: restoring under the SAME instance id leaves the log authoritative.
  const stale = (await h.service.collaborate?.(
    book.container,
    yesterday,
    false,
  )) as WorkbookCollaboration;
  expect(text(stale)).toContain("Today");
  await stale.destroy();

  // Restore as the editor does: the old version under a fresh instance id.
  const restored = { ...yesterday, id: crypto.randomUUID() };
  await h.service.save(book.container, restored, book.version, { force: true });
  await first.destroy().catch(() => {});

  const reopened = (await h.service.collaborate?.(
    book.container,
    restored,
    false,
  )) as WorkbookCollaboration;
  expect(text(reopened)).toContain("Yesterday");
  expect(text(reopened)).not.toContain("Today");
  await reopened.destroy();
  // A later reload reconciles against the new log and still shows the restored cells.
  const again = (await h.service.collaborate?.(
    book.container,
    restored,
    false,
  )) as WorkbookCollaboration;
  expect(text(again)).toContain("Yesterday");
  expect(text(again)).not.toContain("Today");
  await again.destroy();
  expect(
    h.calls.some((call) => call.method === "PUT" && call.url.includes(`/collab/${restored.id}/`)),
  ).toBe(true);
});
