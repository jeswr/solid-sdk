// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { importICal } from "../src/apps/calendar/lib/model";
import { discoverCalendars } from "../src/apps/calendar/state/repository";
import { exportCalendar, importCalendar, importEvents } from "../src/apps/calendar/state/transfer";
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

it("warns and skips TZID series the model cannot persist, including New York during London's rollback", () => {
  const text = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:ny\nSUMMARY:New York weekly\nDTSTART;TZID=America/New_York:20261018T090000\nRRULE:FREQ=WEEKLY;COUNT=4\nEND:VEVENT\nBEGIN:VEVENT\nUID:single\nSUMMARY:New York one-off\nDTSTART;TZID=America/New_York:20261025T090000\nEND:VEVENT\nEND:VCALENDAR`;
  const parsed = importCalendar(text, "Europe/London");
  expect(parsed.events).toHaveLength(1);
  expect(parsed.events[0]?.name).toBe("New York one-off");
  expect(parsed.events[0]?.start).toEqual(new Date("2026-10-25T13:00:00Z"));
  expect(parsed.timeZones).toEqual(["America/New_York"]);
  expect(parsed.skipped).toBe(1);
  expect(parsed.warnings).toEqual([
    expect.stringContaining('"New York weekly": recurring events in America/New_York'),
  ]);
  expect(importCalendar("BEGIN:VCALENDAR\nEND:VCALENDAR", "Europe/London").events).toEqual([]);
  const utc = importCalendar(
    text
      .replaceAll(";TZID=America/New_York", "")
      .replaceAll("20261018T090000", "20261018T130000Z")
      .replaceAll("20261025T090000", "20261025T130000Z"),
    "Europe/London",
  );
  expect(utc.skipped).toBe(0);
  expect(utc.timeZones).toEqual([undefined, undefined]);
});
