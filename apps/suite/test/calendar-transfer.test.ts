// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { importICal } from "../src/apps/calendar/lib/model";
import { discoverCalendars } from "../src/apps/calendar/state/repository";
import { exportCalendar, importEvents } from "../src/apps/calendar/state/transfer";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

it("exports master events with RRULE without expanding them and surfaces read failure", async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00Z")),
  });
  const account = { webId: DEMO_WEBID, storageUrl: DEMO_ROOT, fetch: pod.fetch };
  const calendar = (await discoverCalendars(account)).calendars.find((c) => c.title === "Work")!;
  const text = await exportCalendar(account, calendar);
  expect(text).toContain("RRULE:FREQ=WEEKLY");
  const result = importICal(text);
  expect(result.events.length).toBeGreaterThan(0);
  expect(result.skipped).toBe(0);
  await expect(
    exportCalendar(
      { ...account, fetch: async () => new Response(null, { status: 403 }) },
      calendar,
    ),
  ).rejects.toThrow();
  // Non-event documents in a calendar container are ignored.
  await pod.fetch(new URL("other.ttl", calendar.container), {
    method: "PUT",
    body: "",
    headers: { "Content-Type": "text/turtle" },
  });
  expect(importICal(await exportCalendar(account, calendar)).events).toHaveLength(
    result.events.length,
  );
});
it("bounds concurrency, reports partial failures and progress, including an empty import", async () => {
  const events = Array.from({ length: 8 }, (_, i) => ({ name: `Event ${i}`, start: "2026-11-01" }));
  let active = 0,
    max = 0;
  const progress = vi.fn();
  const result = await importEvents(
    events,
    async (event) => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      if (event.name === "Event 3") throw Error();
    },
    progress,
  );
  expect(max).toBe(3);
  expect(result).toEqual({ imported: 7, failed: ["Event 3"] });
  expect(progress).toHaveBeenLastCalledWith(8);
  expect(await importEvents([], async () => {}, progress)).toEqual({ imported: 0, failed: [] });
});
