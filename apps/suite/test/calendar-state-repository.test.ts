// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  buildCalendar,
  buildEvent,
  CALENDAR_CLASS,
  type CalendarEvent,
  calendarIO,
  EVENT_CLASS,
  NS,
  serializeDataset,
} from "../src/apps/calendar/lib/model";
import {
  type CalendarAccount,
  calendarDocument,
  calendarSlug,
  createCalendar,
  discoverCalendars,
  type EventWrite,
  eventContainer,
  eventMutations,
  loadRange,
} from "../src/apps/calendar/state/repository";
import {
  addDays,
  calendarColour,
  dateKey,
  localDate,
  PALETTE,
  visibleRange,
} from "../src/apps/calendar/state/view";
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeRegistration,
} from "../src/apps/docs/lib/model/type-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { seedCalendar } from "../src/lib/demo-pod/seed-calendar";

const now = Date.UTC(2026, 10, 1, 12);
const root = DEMO_ROOT;
const eventUrl = `${root}calendar/work/new.ttl`;
const event: CalendarEvent = {
  name: "Test event",
  start: new Date(2026, 10, 1, 11),
  end: new Date(2026, 10, 1, 12),
  inCalendar: `${root}calendar/work.ttl#it`,
};
async function setup() {
  const pod = createDemoPod({ root, seed: await buildDemoSeed(now), now: () => now });
  const account: CalendarAccount = { webId: DEMO_WEBID, storageUrl: root, fetch: pod.fetch };
  return { pod, account, io: calendarIO(pod.fetch, root) };
}
function altered(
  account: CalendarAccount,
  change: (url: string, init?: RequestInit) => Response | undefined,
): CalendarAccount {
  return {
    ...account,
    fetch: async (input, init) => change(String(input), init) ?? account.fetch(input, init),
  };
}
async function putGraph(account: CalendarAccount, path: string, graph: Store) {
  return account.fetch(`${root}${path}`, {
    method: "PUT",
    body: await serializeDataset(graph),
    headers: { "Content-Type": "text/turtle" },
  });
}
describe("Calendar repository discovery and demo", () => {
  it("sanitizes hostile RDF calendar colours before they enter view state", async () => {
    const { account, io } = await setup();
    const url = `${root}calendar/work.ttl`;
    const item = await io.loadCalendar(url);
    await io.saveCalendar(
      url,
      { title: "Work", color: "url(https://attacker.example/pixel)" },
      { etag: item?.etag as string },
    );
    const { calendars } = await discoverCalendars(account);
    expect(calendars.find((calendar) => calendar.url === url)?.colour).toBe(calendarColour(url));
  });
  it("parses document/container URLs and safe slugs", () => {
    expect(calendarDocument(`${root}calendar/work.ttl?x=1#it`)).toBe(`${root}calendar/work.ttl`);
    expect(eventContainer(`${root}calendar/work.ttl#it`)).toBe(`${root}calendar/work/`);
    expect(eventContainer(`${root}calendar/work`)).toBe(`${root}calendar/work/`);
    expect(calendarSlug(" My New Calendar! ")).toBe("my-new-calendar");
    expect(() => calendarSlug("♥")).toThrow("Enter a calendar name");
  });
  it("loads registered calendars and expands stand-ups exactly once, including their source ETags", async () => {
    const { account, io } = await setup();
    await io.saveEvent(
      `${root}calendar/work/simultaneous.ttl`,
      { ...event, name: "Simultaneous", start: localDate("2026-11-01") },
      { create: true },
    );
    const { calendars, warnings } = await discoverCalendars(account);
    expect(warnings).toEqual([]);
    expect(calendars.map((c) => c.title).sort()).toEqual(["Personal", "Work"]);
    expect(calendars.every((c) => Boolean(c.etag))).toBe(true);
    const range = await loadRange(
      account,
      calendars,
      localDate("2026-10-26"),
      localDate("2026-11-02"),
      "Europe/London",
    );
    expect(range.warnings).toEqual([]);
    const standups = range.events.filter((e) => e.data.name === "Team stand-up");
    expect(standups).toHaveLength(3);
    expect(standups.map((e) => (e.data.start as Date).toISOString())).toEqual([
      "2026-10-26T09:30:00.000Z",
      "2026-10-28T09:30:00.000Z",
      "2026-10-30T09:30:00.000Z",
    ]);
    expect(standups.every((e) => e.calendar.title === "Work" && e.etag)).toBe(true);
    expect(range.events.filter((e) => e.data.start === "2026-11-01")).toHaveLength(2);
    expect(range.events.filter((e) => /busy-\d\.ttl$/.test(e.url)).map((e) => e.data.name)).toEqual(
      ["Gym", "Call Mum", "Dentist", "Groceries", "Piano lesson", "Read in the park"],
    );
    const hiddenWork = await loadRange(
      account,
      calendars.filter((c) => c.title !== "Work"),
      localDate("2026-10-26"),
      localDate("2026-11-02"),
      "Europe/London",
    );
    expect(hiddenWork.events.every((e) => e.calendar.title === "Personal")).toBe(true);
  });
  it("discovers fallback documents, preferences-linked indexes, aliases and assigns missing colours", async () => {
    const { account, io } = await setup();
    await io.saveCalendar(`${root}calendar/extra.ttl`, { title: "Fallback" }, { create: true });
    await account.fetch(`${root}calendar/readme.txt`, { method: "PUT", body: "Hello" });
    await account.fetch(`${root}calendar/other.ttl`, {
      method: "PUT",
      body: "",
      headers: { "Content-Type": "text/turtle" },
    });
    const profile = new Store();
    new ProfileTypeIndexAnchor(DEMO_WEBID, profile, DataFactory).preferencesFiles.add(
      `${root}settings/prefs.ttl`,
    );
    await putGraph(account, "profile/card", profile);
    const prefs = new Store();
    new ProfileTypeIndexAnchor(DEMO_WEBID, prefs, DataFactory).privateIndexes.add(
      `${root}settings/other-index.ttl`,
    );
    await putGraph(account, "settings/prefs.ttl", prefs);
    const index = new Store();
    for (const [id, type, instance] of [
      ["a", CALENDAR_CLASS, `${root}calendar/extra.ttl#it`],
      ["b", CALENDAR_CLASS, "https://evil.example/calendar.ttl"],
      ["c", `${NS.SCHEMA}Event`, `${root}calendar/work.ttl#it`],
      ["d", CALENDAR_CLASS, undefined],
      ["e", "https://solid.github.io/vocab/scheduling#Calendar", `${root}calendar/extra.ttl#it`],
    ] as const) {
      const reg = new TypeRegistration(`${root}settings/other-index.ttl#${id}`, index, DataFactory);
      reg.markRegistration();
      reg.forClass = type;
      reg.instance = instance;
    }
    const containerReg = new TypeRegistration(
      `${root}settings/other-index.ttl#container`,
      index,
      DataFactory,
    );
    containerReg.markRegistration();
    containerReg.forClass = CALENDAR_CLASS;
    containerReg.instanceContainer = `${root}registered/`;
    await account.fetch(`${root}registered/extra.ttl`, {
      method: "PUT",
      body: await serializeDataset(
        buildCalendar(`${root}registered/extra.ttl`, { title: "Container calendar" }),
      ),
      headers: { "Content-Type": "text/turtle" },
    });
    const unsafeReg = new TypeRegistration(
      `${root}settings/other-index.ttl#unsafe`,
      index,
      DataFactory,
    );
    unsafeReg.markRegistration();
    unsafeReg.forClass = CALENDAR_CLASS;
    unsafeReg.instanceContainer = "https://evil.example/calendar/";
    await putGraph(account, "settings/other-index.ttl", index);
    const result = await discoverCalendars(account);
    expect(result.calendars).toHaveLength(4);
    expect(result.calendars.find((c) => c.title === "Fallback")?.colour).toMatch(/^oklch/);
    expect(result.warnings).toEqual([]);
  });
  it("treats only a missing fallback container as empty, preserving access and network errors", async () => {
    const { account } = await setup();
    await putGraph(account, "profile/card", new Store());
    const missing = altered(account, (url) =>
      url === `${root}calendar/` ? new Response(null, { status: 404 }) : undefined,
    );
    expect(await discoverCalendars(missing)).toEqual({ calendars: [], warnings: [] });
    const denied = altered(account, (url) =>
      url === `${root}calendar/` ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(discoverCalendars(denied)).rejects.toThrow();
    await expect(
      discoverCalendars({
        ...account,
        fetch: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });
  it("falls back from a confirmed missing index and fails closed for an unreadable index", async () => {
    const { account } = await setup();
    const indexUrl = `${root}settings/privateTypeIndex.ttl`;
    const missing = altered(account, (url) =>
      url === indexUrl ? new Response(null, { status: 404 }) : undefined,
    );
    expect((await discoverCalendars(missing)).calendars).toHaveLength(2);
    const denied = altered(account, (url) =>
      url === indexUrl ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(discoverCalendars(denied)).rejects.toThrow();
    await expect(
      discoverCalendars({
        ...account,
        fetch: async (input, init) => {
          if (String(input) === indexUrl) throw new Error("offline");
          return account.fetch(input, init);
        },
      }),
    ).rejects.toThrow("offline");
    await expect(
      discoverCalendars({
        ...account,
        fetch: async (input, init) => {
          if (String(input) === `${root}calendar/`) throw new Error("offline");
          return account.fetch(input, init);
        },
      }),
    ).rejects.toThrow("offline");
  });
  it("keeps readable calendars/events when one calendar fails", async () => {
    const { account } = await setup();
    const bad = altered(account, (url) =>
      url === `${root}calendar/work.ttl` ? new Response(null, { status: 403 }) : undefined,
    );
    const result = await discoverCalendars(bad);
    expect(result.calendars.map((c) => c.title)).toEqual(["Personal"]);
    expect(result.warnings).toHaveLength(1);
    const all = await discoverCalendars(account);
    const range = await loadRange(
      altered(account, (url) =>
        url === `${root}calendar/work/` ? new Response(null, { status: 500 }) : undefined,
      ),
      all.calendars,
      localDate("2026-11-01"),
      localDate("2026-11-02"),
      "UTC",
    );
    expect(range.events.length).toBeGreaterThan(0);
    expect(range.warnings[0]?.title).toBe("Could not load events from Work");
  });
  it("creates calendar documents, containers and both registrations conditionally", async () => {
    const { account, io } = await setup();
    await createCalendar(account, " New Calendar ", PALETTE[0] as string);
    const item = await io.loadCalendar(`${root}calendar/new-calendar.ttl`);
    expect(item?.data).toEqual({ title: "New Calendar", color: PALETTE[0] as string });
    expect((await discoverCalendars(account)).calendars).toHaveLength(3);
    await expect(createCalendar(account, "New Calendar", PALETTE[0] as string)).rejects.toThrow();
    await createCalendar(
      altered(account, (url, init) =>
        url.endsWith("existing/") && init?.method === "PUT"
          ? new Response(null, { status: 412 })
          : undefined,
      ),
      "Existing",
      PALETTE[0] as string,
    );
    await expect(
      createCalendar(
        altered(account, (url, init) =>
          url.endsWith("broken/") && init?.method === "PUT"
            ? new Response(null, { status: 500 })
            : undefined,
        ),
        "Broken",
        PALETTE[0] as string,
      ),
    ).rejects.toThrow("500");
  });
  it("creates an exclusive calendar under a fresh slug and refuses an existing events folder", async () => {
    const { account, io } = await setup();
    const first = await createCalendar(account, "Family", PALETTE[0] as string, {
      exclusive: true,
    });
    const second = await createCalendar(account, "Family", PALETTE[0] as string, {
      exclusive: true,
    });
    expect(first).toMatch(/calendar\/family-[0-9a-f-]{36}\.ttl$/);
    expect(second).not.toBe(first);
    expect((await io.loadCalendar(first))?.data.title).toBe("Family");
    // An events folder that already exists is never adopted (it would then be shared).
    await expect(
      createCalendar(
        altered(account, (url, init) =>
          /family-[^/]+\/$/.test(url) && init?.method === "PUT"
            ? new Response(null, { status: 412 })
            : undefined,
        ),
        "Family",
        PALETTE[0] as string,
        { exclusive: true },
      ),
    ).rejects.toThrow("412");
    expect(await createCalendar(account, "Plain", PALETTE[0] as string)).toBe(
      `${root}calendar/plain.ttl`,
    );
  });
});
describe("Calendar optimistic event writes", () => {
  it("creates, updates and deletes with conditional ETags, chaining fresh ETags for queued writes", async () => {
    const { account, io } = await setup();
    const changed = vi.fn();
    const invalidate = vi.fn();
    const failed = vi.fn();
    const mutate = eventMutations(account, changed, invalidate, failed);
    const creation = mutate({ kind: "create", url: eventUrl, data: event });
    expect(changed.mock.calls[0]?.[0]).toEqual([{ kind: "create", url: eventUrl, data: event }]);
    const update = mutate({
      kind: "update",
      url: eventUrl,
      data: { ...event, name: "Changed" },
      etag: '"stale"',
    });
    expect(changed.mock.calls[1]?.[0]).toHaveLength(2);
    await Promise.all([creation, update]);
    const saved = await io.loadEvent(eventUrl);
    expect(saved?.data.name).toBe("Changed");
    await mutate({ kind: "delete", url: eventUrl, etag: saved?.etag as string });
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(failed).not.toHaveBeenCalled();
    expect(changed.mock.lastCall?.[0]).toEqual([
      { kind: "delete", url: eventUrl, etag: saved?.etag, confirmation: { etag: null } },
    ]);
    await expect(io.loadEvent(eventUrl)).rejects.toThrow();
  });
  it("rolls back failed intents without dropping newer updates, including two failures", async () => {
    const { account, io } = await setup();
    const etag = (await io.saveEvent(eventUrl, event, { create: true })) as string;
    let attempt = 0;
    const changed = vi.fn();
    const failed = vi.fn();
    const broken = altered(account, (url, init) => {
      if (url === eventUrl && init?.method === "PUT" && ++attempt <= 2)
        return new Response(null, { status: 500 });
      return undefined;
    });
    const mutate = eventMutations(broken, changed, vi.fn(), failed);
    const a: EventWrite = { kind: "update", url: eventUrl, data: { ...event, name: "A" }, etag };
    const b: EventWrite = { ...a, data: { ...event, name: "B" } };
    const c: EventWrite = { ...a, data: { ...event, location: "new location" } };
    const results = await Promise.allSettled([mutate(a), mutate(b), mutate(c)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "fulfilled"]);
    expect(
      changed.mock.calls.some(([queue]) => queue.length === 2 && queue[0] === b && queue[1] === c),
    ).toBe(true);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls[0]?.[1]).toBe(false);
    expect((await io.loadEvent(eventUrl))?.data.location).toBe("new location");
  });
  it("reloads 412 conflicts and allows a subsequent explicit edit with the current ETag", async () => {
    const { account, io } = await setup();
    await io.saveEvent(eventUrl, event, { create: true });
    const failed = vi.fn();
    const mutate = eventMutations(account, vi.fn(), vi.fn(), failed);
    await expect(
      mutate({
        kind: "update",
        url: eventUrl,
        data: { ...event, name: "Conflict" },
        etag: '"wrong"',
      }),
    ).rejects.toThrow("412");
    expect(failed.mock.calls[0]?.[1]).toBe(true);
    await mutate({
      kind: "update",
      url: eventUrl,
      data: { ...event, name: "Reconciled" },
      etag: (await io.loadEvent(eventUrl))?.etag as string,
    });
    expect((await io.loadEvent(eventUrl))?.data.name).toBe("Reconciled");
  });
  it("rejects already queued intents after a conflict without overwriting another client's changes", async () => {
    const { account, io } = await setup();
    const old = (await io.saveEvent(eventUrl, event, { create: true })) as string;
    await io.saveEvent(eventUrl, { ...event, description: "Remote change" }, { etag: old });
    const failed = vi.fn();
    const mutate = eventMutations(account, vi.fn(), vi.fn(), failed);
    const results = await Promise.allSettled([
      mutate({ kind: "update", url: eventUrl, etag: old, data: { ...event, name: "Queued A" } }),
      mutate({ kind: "update", url: eventUrl, etag: old, data: { ...event, name: "Queued B" } }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect((await io.loadEvent(eventUrl))?.data.description).toBe("Remote change");
    expect(failed).toHaveBeenCalledTimes(2);
  });
  it("handles absent ETags and unavailable/deleted conflict masters", async () => {
    const { account, io } = await setup();
    const noEtag: CalendarAccount = {
      ...account,
      fetch: async (input, init) => {
        const response = await account.fetch(input, init);
        if (init?.method !== "PUT") return response;
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(null, { status: response.status, headers });
      },
    };
    const mutate = eventMutations(noEtag, vi.fn(), vi.fn(), vi.fn());
    await mutate({ kind: "create", url: eventUrl, data: event });
    const current = await io.loadEvent(eventUrl);
    await mutate({ kind: "update", url: eventUrl, data: event, etag: current?.etag as string });
    const refreshed = await io.loadEvent(eventUrl);
    await mutate({ kind: "delete", url: eventUrl, etag: refreshed?.etag as string });
    const failed = vi.fn();
    const conflict = eventMutations(
      altered(account, (_url, init) =>
        init?.method === "PUT" ? new Response(null, { status: 412 }) : undefined,
      ),
      vi.fn(),
      vi.fn(),
      failed,
    );
    await expect(conflict({ kind: "create", url: eventUrl, data: event })).rejects.toThrow("412");
    expect(failed).toHaveBeenCalled();
    await account.fetch(eventUrl, {
      method: "PUT",
      body: await serializeDataset(buildCalendar(eventUrl, { title: "Not an event" })),
      headers: { "Content-Type": "text/turtle" },
    });
    await expect(conflict({ kind: "create", url: eventUrl, data: event })).rejects.toThrow("412");
    const noReadEtag = eventMutations(
      {
        ...noEtag,
        fetch: async (_input, init) => {
          if (init?.method === "PUT") return new Response(null, { status: 412 });
          return new Response(await serializeDataset(buildEvent(eventUrl, event)), {
            headers: { "Content-Type": "text/turtle" },
          });
        },
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await expect(noReadEtag({ kind: "create", url: eventUrl, data: event })).rejects.toThrow("412");
  });
});

it.each([
  "container",
  "index",
  "registration",
])("resumes calendar creation after a failed %s without overwriting existing resources", async (stage) => {
  const { account, io } = await setup();
  const puts: string[] = [];
  let broken = true;
  const recovering = altered(account, (url, init) => {
    if (init?.method === "PUT") puts.push(url);
    if (
      broken &&
      ((stage === "container" && url.endsWith("recover/") && init?.method === "PUT") ||
        (stage === "index" && url.endsWith("privateTypeIndex.ttl") && init?.method !== "PUT") ||
        (stage === "registration" &&
          url.endsWith("privateTypeIndex.ttl") &&
          init?.method === "PUT"))
    )
      return new Response(null, { status: 500 });
    return undefined;
  });
  await expect(createCalendar(recovering, "Recover", PALETTE[0] as string)).rejects.toThrow();
  const original = await io.loadCalendar(`${root}calendar/recover.ttl`);
  broken = false;
  await createCalendar(recovering, "Recover", PALETTE[0] as string);
  expect(await io.loadCalendar(`${root}calendar/recover.ttl`)).toEqual(original);
  expect(puts.filter((url) => url.endsWith("recover.ttl"))).toHaveLength(1);
  expect((await discoverCalendars(account)).calendars.some((c) => c.title === "Recover")).toBe(
    true,
  );
  await expect(createCalendar(recovering, "Recover", PALETTE[0] as string)).rejects.toThrow("412");
});

it("retains each confirmed write and its returned ETag until a range can acknowledge it", async () => {
  const { account, io } = await setup();
  const changed = vi.fn();
  const mutate = eventMutations(account, changed, vi.fn(), vi.fn());
  await mutate({ kind: "create", url: eventUrl, data: event });
  const created = await io.loadEvent(eventUrl);
  expect(changed.mock.lastCall?.[0]).toEqual([
    { kind: "create", url: eventUrl, data: event, confirmation: { etag: created?.etag } },
  ]);
  await mutate({
    kind: "update",
    url: eventUrl,
    data: { ...event, name: "Renamed" },
    etag: created?.etag as string,
  });
  const updated = await io.loadEvent(eventUrl);
  expect(changed.mock.lastCall?.[0]).toEqual([
    {
      kind: "update",
      url: eventUrl,
      data: { ...event, name: "Renamed" },
      etag: created?.etag,
      confirmation: { etag: updated?.etag },
    },
  ]);
  await expect(
    mutate({ kind: "update", url: eventUrl, data: event, etag: '"stale"' }),
  ).rejects.toThrow("412");
  expect(changed.mock.lastCall?.[0]).toEqual([]);
});

it.each([
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-30",
])("seeds a three-day trip intersecting the current week and month on %s", async (day) => {
  const pod = createDemoPod({ root, seed: await buildDemoSeed(+localDate(day)) });
  const io = calendarIO(pod.fetch, root);
  const trip = await io.loadEvent(`${root}calendar/personal/trip.ttl`);
  expect(trip?.data.start).toBe(day);
  expect(trip?.data.end).toBe(addDays(day, 3));
  for (let weekStart = 0; weekStart < 7; weekStart++) {
    const range = visibleRange("week", day, weekStart);
    expect(
      (
        await io.eventsInRange(
          `${root}calendar/personal/`,
          localDate(range.from),
          localDate(range.to),
        )
      ).some((e) => e.data.name === "Three-day trip"),
    ).toBe(true);
  }
  expect(dateKey(trip?.data.start as string).slice(0, 7)).toBe(day.slice(0, 7));
});

it("seeds both registrations through the model without removing another app's registration", async () => {
  const { deserializeDataset } = await import("../src/apps/calendar/lib/model");
  const files = await buildDemoSeed(now);
  const indexUrl = `${root}settings/privateTypeIndex.ttl`;
  const original = files.find((file) => file.path === "settings/privateTypeIndex.ttl");
  const graph = await deserializeDataset(original?.body as string, indexUrl);
  const reg = new TypeRegistration(`${indexUrl}#unrelated`, graph, DataFactory);
  reg.markRegistration();
  reg.forClass = "https://schema.org/TextDigitalDocument";
  reg.instanceContainer = `${root}docs/`;
  const awaitBody = await serializeDataset(graph);
  const seeded = await seedCalendar(
    files.map((file) => (file === original ? { ...file, body: awaitBody } : file)),
    now,
  );
  const dataset = await deserializeDataset(
    seeded.find((file) => file.path === "settings/privateTypeIndex.ttl")?.body as string,
    indexUrl,
  );
  const entries = new TypeIndexDataset(dataset, DataFactory).all();
  expect(
    entries
      .filter((r) => r.forClass === CALENDAR_CLASS)
      .map((r) => r.instance)
      .sort(),
  ).toEqual([`${root}calendar/personal.ttl#it`, `${root}calendar/work.ttl#it`]);
  expect(
    entries
      .filter((r) => r.forClass === EVENT_CLASS)
      .map((r) => r.container)
      .sort(),
  ).toEqual([`${root}calendar/personal/`, `${root}calendar/work/`]);
  expect(entries.some((r) => r.forClass === "https://schema.org/TextDigitalDocument")).toBe(true);
});
