// AUTHORED-BY Codex GPT-6.1-Sol
import { createInboxReader } from "@jeswr/pod-access/notify";
import { sharedItemsFromInbox } from "@jeswr/suite-sdk/shared";
import { expect, it } from "vitest";
import { parseWorkbook, workbookLayout } from "../src/apps/sheets/lib/model/rdf";
import { deserializeSnapshot } from "../src/apps/sheets/lib/model/snapshot";
import { DEMO_ROOT } from "../src/lib/demo-pod/constants";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed } from "../src/lib/demo-pod/seed";

it("the real demo inbox yields four named shares with roles, dates and usable sheet data", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const seed = await buildDemoSeed(now, { calendar: false });
  const pod = createDemoPod({ root: DEMO_ROOT, seed, now: () => now });
  // Host the inbox transport at an IP literal so this Node test never needs DNS.
  // Activity/object identities remain exactly those of the browser demo.
  const inboxRoot = "https://8.8.8.8/";
  const inboxPod = createDemoPod({ root: inboxRoot, seed, now: () => now });
  const reader = createInboxReader({ fetch: inboxPod.fetch });
  const items = sharedItemsFromInbox(await reader.list(`${inboxRoot}inbox/`));
  expect(items.map((item) => [item.name, item.app, item.role])).toEqual([
    ["Launch plan", "docs", "Editor"],
    ["Trip budget", "sheets", "Viewer"],
    ["Weekend plans", "tasks", "Editor"],
    ["Team calendar", "calendar", "Viewer"],
  ]);
  expect(items.every((item) => item.sharedAt && item.sharedBy)).toBe(true);
  const container = `${DEMO_ROOT}sheets/trip-budget/`;
  const layout = workbookLayout(container);
  const metadata = await parseWorkbook(container, await (await pod.fetch(layout.index)).text());
  expect(metadata.title).toBe("Trip budget");
  const snapshot = deserializeSnapshot(await (await pod.fetch(layout.snapshot)).text());
  expect(snapshot.sheetOrder).toEqual(["sheet1"]);
  expect(await (await pod.fetch(`${DEMO_ROOT}tasks/projects/weekend-plans.ttl`)).text()).toContain(
    "Weekend plans",
  );
});
