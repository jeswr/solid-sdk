// @vitest-environment jsdom
// AUTHORED-BY Claude Sonnet 5.5
import { expect, it, vi } from "vitest";
import { readCharts, withCharts } from "../src/apps/sheets/lib/charts/spec";
import { cells, LOCAL_ORIGIN, sheetStates } from "../src/apps/sheets/lib/collaboration/model";
import type { WorkbookCollaboration } from "../src/apps/sheets/lib/collaboration/persistence";
import { harness, snapshot } from "./sheets-workbook-helpers";

it("keeps a published save successful when the stale-projection cleanup listing fails", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Cleanup", snapshot: snapshot() });
  const sheetRoot = `${book.container}sheets/`;
  h.setHook((call) => (call.url === sheetRoot ? new Response(null, { status: 503 }) : undefined));
  const saved = await h.service.save(book.container, snapshot("Changed\nrows"), book.version);
  expect(saved.version.snapshotEtag).not.toBe(book.version.snapshotEtag);
  expect(h.calls.some((call) => call.url === sheetRoot)).toBe(true);
});

it("validates chart metadata when creating a workbook", async () => {
  const h = await harness();
  const base = snapshot();
  const charted = withCharts(base, [
    {
      id: "chart",
      sheetId: Object.keys(base.sheets as object)[0] as string,
      range: "A1:B2",
      type: "column",
      title: "Totals",
      legend: true,
      series: "columns",
    },
  ]);
  const book = await h.service.create({ title: "Charted", snapshot: charted });
  expect(book.snapshot.charts).toBeDefined();
  // Invalid chart entries are dropped with a warning instead of being stored.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const bad = await h.service.create({
    title: "Bad chart",
    snapshot: { ...charted, charts: { version: 1, entries: [{ id: "x" }] } } as never,
  });
  expect(readCharts(bad.snapshot).charts).toEqual([]);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it("deletes a workbook even when closing its collaboration publisher fails", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Remove", snapshot: snapshot() });
  const runtime = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  const state = sheetStates(runtime.doc).values().next().value as NonNullable<
    ReturnType<ReturnType<typeof sheetStates>["get"]>
  >;
  runtime.doc.transact(() => cells(state).set("a|b", { v: "Unsent" }), LOCAL_ORIGIN);
  h.setHook((call) =>
    call.method === "PUT" && call.url.includes("/collab/")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(h.service.remove(book.container)).resolves.toBeUndefined();
  h.setHook(() => undefined);
  await expect(h.service.open(book.container)).rejects.toThrow();
});
