// AUTHORED-BY Claude Sonnet 5.5
import { expect, it } from "vitest";
import type { WorkbookCollaboration } from "../src/apps/sheets/lib/collaboration/persistence";
import { harness, snapshot } from "./sheets-workbook-helpers";

it("opens a collaboration without browser event wiring outside a window", async () => {
  expect(typeof window).toBe("undefined");
  const h = await harness();
  const book = await h.service.create({ title: "Server side", snapshot: snapshot() });
  const runtime = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  expect(runtime.localMirrorUnavailable).toBe(true);
  await runtime.destroy();
});
