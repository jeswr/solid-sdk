// AUTHORED-BY Codex GPT-6.1-Sol
import { createInboxReader } from "@jeswr/pod-access/notify";
import { sharedItemsFromInbox } from "@jeswr/suite-sdk/shared";
import { expect, it } from "vitest";
import { parseWorkbook, workbookLayout } from "../src/apps/sheets/lib/model/rdf";
import { deserializeSnapshot } from "../src/apps/sheets/lib/model/snapshot";
import { DEMO_ROOT, FRIENDS_ROOT } from "../src/lib/demo-pod/constants";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed } from "../src/lib/demo-pod/seed";
import { seedFriendsPod } from "../src/lib/demo-pod/seed-friends";

it("the real demo inbox yields four named shares outside the demo storage, with roles, dates and usable sheet data", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const seed = await buildDemoSeed(now, { calendar: false });
  // Host the inbox transport at an IP literal so this Node test never needs DNS.
  // Activity/object identities remain exactly those of the browser demo.
  const inboxRoot = "https://8.8.8.8/";
  const inboxPod = createDemoPod({ root: inboxRoot, seed, now: () => now });
  const reader = createInboxReader({ fetch: inboxPod.fetch });
  // Pass the storage as the app does: shares inside it are never "shared with me".
  const items = sharedItemsFromInbox(await reader.list(`${inboxRoot}inbox/`), {
    storageUrl: DEMO_ROOT,
  });
  expect(items.map((item) => [item.name, item.app, item.role])).toEqual([
    ["Launch plan", "docs", "Editor"],
    ["Trip budget", "sheets", "Viewer"],
    ["Weekend plans", "tasks", "Editor"],
    ["Team calendar", "calendar", "Viewer"],
  ]);
  expect(items.every((item) => item.sharedAt && item.sharedBy)).toBe(true);
  expect(items.every((item) => item.url.startsWith(FRIENDS_ROOT))).toBe(true);
  expect(items.every((item) => item.announced && item.fromAnotherPod)).toBe(true);
  // The announced resources live in the fictional friends' pod, which the demo serves.
  const friends = createDemoPod({
    root: FRIENDS_ROOT,
    seed: await seedFriendsPod(now),
    now: () => now,
  });
  for (const item of items) expect((await friends.fetch(item.url)).status, item.url).toBe(200);
  const container = `${FRIENDS_ROOT}sheets/trip-budget/`;
  const layout = workbookLayout(container);
  const metadata = await parseWorkbook(container, await (await friends.fetch(layout.index)).text());
  expect(metadata.title).toBe("Trip budget");
  const snapshot = deserializeSnapshot(await (await friends.fetch(layout.snapshot)).text());
  expect(snapshot.sheetOrder).toEqual(["sheet1"]);
  expect(
    await (await friends.fetch(`${FRIENDS_ROOT}tasks/projects/weekend-plans.ttl`)).text(),
  ).toContain("Weekend plans");
});

it("the demo user's own pod announces nothing inside itself and holds none of the shared resources", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const seed = await buildDemoSeed(now, { calendar: false });
  expect(seed.map((file) => file.path)).not.toContain("tasks/projects/weekend-plans.ttl");
  expect(seed.map((file) => file.path)).not.toContain("sheets/trip-budget/");
});
