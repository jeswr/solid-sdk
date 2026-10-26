// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { CalendarEvent } from "../core/vocab.js";
import { googleCalendarAdapter } from "./adapter.js";
import { EVENTS } from "./fixtures.js";
import { GoogleCalendarEvent, RecurrenceRule } from "./vocab-map.js";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DOC = `${TEST_POD_ROOT}integrations/google-calendar/calendar/events.ttl`;
const route = (json: unknown, status = 200): FixtureRoute => ({ url: API, json, status });

function setup() {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: "google-calendar",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const run = (routes: FixtureRoute[], state?: ConnectorState) => {
    const api = vi.fn(fixtureFetch("google-calendar", routes));
    return {
      api,
      result: runImport({
        adapter: googleCalendarAdapter,
        mode: "live",
        sourceAuth: { fetch: api },
        podWriter,
        state,
      }),
    };
  };
  return { pod, podWriter, run };
}

describe("Google Calendar synchronization", () => {
  it("continues full and incremental pages using the final sync token", async () => {
    const { pod, run } = setup();
    const first = run([
      route({ items: [EVENTS.items[0]], nextPageToken: "page+/=" }),
      route({ items: [EVENTS.items[1]], nextSyncToken: "sync+/=" }),
    ]);
    const initial = await first.result;
    expect(initial.cursor).toBe("sync+/=");
    const urls = first.api.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get("singleEvents")).toBe("false");
    expect(urls[1].searchParams.get("pageToken")).toBe("page+/=");
    expect(urls[0].searchParams.has("orderBy")).toBe(false);

    const next = run(
      [
        route({ items: [{ ...EVENTS.items[0], summary: "Updated" }], nextPageToken: "next" }),
        route({ items: [EVENTS.items[2]], nextSyncToken: "new-sync" }),
      ],
      initial.state,
    );
    const continued = await next.result;
    expect(continued.cursor).toBe("new-sync");
    for (const [url] of next.api.mock.calls) {
      const params = new URL(String(url)).searchParams;
      expect(params.get("syncToken")).toBe("sync+/=");
      expect(params.get("showDeleted")).toBe("true");
    }
    expect(
      new CalendarEvent(`${DOC}#event-${EVENTS.items[0].id}`, pod.dataset(DOC), DataFactory).name,
    ).toBe("Updated");
    expect(
      new CalendarEvent(`${DOC}#event-${EVENTS.items[1].id}`, pod.dataset(DOC), DataFactory).name,
    ).toBe("Dentist");
    expect(
      pod
        .dataset(DOC)
        .getQuads(null, DataFactory.namedNode("https://schema.org/identifier"), null, null),
    ).toHaveLength(3);
  });

  it("deletes cancelled events and their recurrence nodes without losing unchanged items", async () => {
    const { pod, run } = setup();
    const initial = await run([
      route({
        items: [
          { ...EVENTS.items[0], recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"] },
          EVENTS.items[1],
        ],
        nextSyncToken: "one",
      }),
    ]).result;
    await run(
      [route({ items: [{ id: EVENTS.items[0].id, status: "cancelled" }], nextSyncToken: "two" })],
      initial.state,
    ).result;
    expect(
      [...pod.dataset(DOC)].some((q) =>
        q.subject.value.startsWith(`${DOC}#event-${EVENTS.items[0].id}`),
      ),
    ).toBe(false);
    expect(
      new CalendarEvent(`${DOC}#event-${EVENTS.items[1].id}`, pod.dataset(DOC), DataFactory).name,
    ).toBe("Dentist");
  });

  it("discards partial increments after 410 and replaces old data with every full-resync page", async () => {
    const { pod, run } = setup();
    const initial = await run([route({ ...EVENTS, nextSyncToken: "expired" })]).result;
    const reset = run(
      [
        route({
          items: [{ ...EVENTS.items[0], summary: "Discard me" }],
          nextPageToken: "stale-page",
        }),
        route({}, 410),
        route({ items: [EVENTS.items[1]], nextPageToken: "full-page" }),
        route({ items: [], nextSyncToken: "fresh" }),
      ],
      initial.state,
    );
    expect((await reset.result).cursor).toBe("fresh");
    const urls = reset.api.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[1].searchParams.get("syncToken")).toBe("expired");
    expect(urls[2].searchParams.has("syncToken")).toBe(false);
    expect(urls[2].searchParams.has("pageToken")).toBe(false);
    expect(urls[3].searchParams.get("pageToken")).toBe("full-page");
    expect(
      pod
        .dataset(DOC)
        .getQuads(null, DataFactory.namedNode("https://schema.org/identifier"), null, null),
    ).toHaveLength(1);
  });

  it.each([
    401, 403, 429, 500, 410,
  ])("preserves the existing document and cursor on failed resync (%s)", async (status) => {
    const { pod, run, podWriter } = setup();
    const initial = await run([route({ ...EVENTS, nextSyncToken: "keep" })]).result;
    const before = pod.get(DOC);
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: googleCalendarAdapter,
        mode: "live",
        podWriter,
        sourceAuth: { fetch: fixtureFetch("google-calendar", [route({}, 410), route({}, status)]) },
        state: initial.state,
        onState,
      }),
    ).rejects.toMatchObject({ status });
    expect(pod.get(DOC)).toBe(before);
    expect(onState.mock.calls[0][0].cursor).toBe("keep");
  });

  it("rejects incomplete pagination and missing checkpoints before writing", async () => {
    const { pod, run } = setup();
    for (const json of [
      { items: [], nextPageToken: "loop" },
      { items: [] },
      { nextSyncToken: "invalid", items: {} },
    ]) {
      await expect(run([route(json)]).result).rejects.toThrow();
      expect(pod.get(DOC)).toBeUndefined();
    }
  });

  it("persists cancelled and moved recurrence exceptions across master updates", async () => {
    const { pod, run } = setup();
    const master = EVENTS.items[0];
    const cancelled = {
      id: "cancelled-instance",
      status: "cancelled",
      recurringEventId: master.id,
      originalStartTime: { dateTime: "2026-06-15T09:00:00+01:00" },
    };
    const moved = {
      ...master,
      id: "moved-instance",
      recurrence: undefined,
      recurringEventId: master.id,
      originalStartTime: { dateTime: "2026-06-16T09:00:00+01:00" },
      start: { dateTime: "2026-06-16T10:00:00+01:00" },
      end: { dateTime: "2026-06-16T10:15:00+01:00" },
    };
    const initial = await run([
      route({ items: [cancelled, moved, master], nextSyncToken: "initial" }),
    ]).result;
    const ruleIri = `${DOC}#event-${master.id}/recurrence-0`;
    const exceptions = () => [
      ...new RecurrenceRule(ruleIri, pod.dataset(DOC), DataFactory).exceptions,
    ];
    expect(exceptions()).toEqual(
      expect.arrayContaining(["2026-06-15T09:00:00+01:00", "2026-06-16T09:00:00+01:00"]),
    );
    expect(
      new CalendarEvent(
        `${DOC}#event-moved-instance`,
        pod.dataset(DOC),
        DataFactory,
      ).startDate?.toISOString(),
    ).toBe("2026-06-16T09:00:00.000Z");
    const updated = await run(
      [route({ items: [{ ...master, summary: "New master" }], nextSyncToken: "updated" })],
      initial.state,
    ).result;
    expect(exceptions()).toEqual(
      expect.arrayContaining(["2026-06-15T09:00:00+01:00", "2026-06-16T09:00:00+01:00"]),
    );
    await run(
      [route({ items: [{ id: master.id, status: "cancelled" }], nextSyncToken: "deleted" })],
      updated.state,
    ).result;
    expect([...pod.dataset(DOC)].filter((q) => q.subject.value.includes("#event-"))).toHaveLength(
      0,
    );
  });

  it("removes obsolete recurrence and optional fields when an event becomes a single event", async () => {
    const { pod, run } = setup();
    const initial = await run([route(EVENTS)]).result;
    const updated = {
      ...EVENTS.items[0],
      recurrence: [],
      description: undefined,
      location: undefined,
    };
    await run([route({ items: [updated], nextSyncToken: "single" })], initial.state).result;
    const event = new GoogleCalendarEvent(
      `${DOC}#event-${updated.id}`,
      pod.dataset(DOC),
      DataFactory,
    );
    expect([...event.recurrence]).toEqual([]);
    expect(event.location).toBeUndefined();
    expect(event.description).toBeUndefined();
    expect(
      [...pod.dataset(DOC)].some((q) => q.subject.value.startsWith(`${DOC}#event-${updated.id}/`)),
    ).toBe(false);
  });

  it("fetches a full snapshot if the local document is missing and handles an empty calendar", async () => {
    const { pod, run } = setup();
    const request = run([route({ nextSyncToken: "empty" })], {
      connectedAt: "2026-01-01T00:00:00Z",
      cursor: "orphan",
      lastOutcome: "success",
      counts: { documents: 1, items: 1, skipped: 0 },
    });
    expect((await request.result).cursor).toBe("empty");
    expect(new URL(String(request.api.mock.calls[0][0])).searchParams.has("syncToken")).toBe(false);
    expect(pod.get(DOC)).toBeDefined();
    expect(
      pod
        .dataset(DOC)
        .getQuads(null, DataFactory.namedNode("https://schema.org/identifier"), null, null),
    ).toHaveLength(0);
  });

  it("reports malformed items and confines hostile identifiers to deterministic fragments", async () => {
    const { pod, run } = setup();
    const result = await run([
      route({
        items: [
          null,
          {},
          { id: "no-dates" },
          {
            ...EVENTS.items[1],
            id: "odd/#?id",
            htmlLink: undefined,
            created: "bad",
            updated: "bad",
          },
          { ...EVENTS.items[1], id: "empty-dates", start: {} },
        ],
        nextSyncToken: "safe",
      }),
    ]).result;
    expect(result.skipped).toBe(4);
    const item = new CalendarEvent(
      `${DOC}#event-${encodeURIComponent("odd/#?id")}`,
      pod.dataset(DOC),
      DataFactory,
    );
    expect(item.name).toBe("Dentist");
    expect(item.sourceUrl).toBe(`${API}/${encodeURIComponent("odd/#?id")}`);
    expect(item.dateCreated).toBeUndefined();
  });

  it("keeps the previous document and cursor when an unsupported recurrence arrives", async () => {
    const { pod, run } = setup();
    const initial = await run([route(EVENTS)]).result;
    const before = pod.get(DOC);
    await expect(
      run(
        [
          route({
            items: [{ ...EVENTS.items[0], recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2MO"] }],
            nextSyncToken: "unused",
          }),
        ],
        initial.state,
      ).result,
    ).rejects.toThrow(/recurrence/);
    expect(pod.get(DOC)).toBe(before);
  });

  it("retains conditional-write protection when the document changes during the source request", async () => {
    const { pod, podWriter, run } = setup();
    const initial = await run([route(EVENTS)]).result;
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: googleCalendarAdapter,
        mode: "live",
        podWriter,
        state: initial.state,
        onState,
        sourceAuth: {
          fetch: async () => {
            await pod.fetch(DOC, { method: "PUT", body: pod.get(DOC) });
            return Response.json({ items: [], nextSyncToken: "unused" });
          },
        },
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(onState.mock.calls[0][0].cursor).toBe(initial.cursor);
  });
});
