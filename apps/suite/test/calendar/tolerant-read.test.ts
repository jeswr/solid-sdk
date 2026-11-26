// AUTHORED-BY Claude Sonnet 5.5 (tolerant reads for values the generated calendar readers drop)
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  calendarIO,
  deserializeDataset,
  EventDoc,
  expandEvent,
  NS,
  parseCalendar,
  parseEvent,
  serializeDataset,
} from "../../src/apps/calendar/lib/model";
import { loadRange } from "../../src/apps/calendar/state/repository";

const root = "https://pod.example/";
const container = `${root}calendar/work/`;
const url = `${container}event.ttl`;
const calUrl = `${root}calendar/work.ttl`;
const prefixes = `@prefix s: <${NS.SCHEMA}>. @prefix j: <${NS.SCHEDULING}>. @prefix dct: <${NS.DCT}>. @prefix xsd: <${NS.XSD}>.`;
const start = `s:startDate "2026-03-02T09:00:00Z"^^xsd:dateTime`;
const parse = async (body: string, at = url) =>
  parseEvent(at, await deserializeDataset(`${prefixes} ${body}`, at));

describe("events keep values the generated readers would drop", () => {
  it("keeps a tagged description, location and non-string uid through load, edit and save", async () => {
    const data = await parse(
      `<#it> a j:CalendarEvent; s:name "Review"; ${start}; s:description "Agenda: budget"@en; s:location "Room 1"@en, "Room 2"@fr; s:identifier 7.`,
    );
    expect(data).toMatchObject({ description: "Agenda: budget", uid: "7" });
    expect(["Room 1", "Room 2"]).toContain(data?.location);
    // The app's edit cycle: parse, mutate, rebuild, full-document PUT body.
    const moved = {
      ...(data as NonNullable<typeof data>),
      start: new Date("2026-03-03T09:00:00Z"),
    };
    const saved = await deserializeDataset(await serializeDataset(buildEvent(url, moved)), url);
    expect(parseEvent(url, saved)).toMatchObject({
      description: "Agenda: budget",
      uid: "7",
      location: data?.location,
    });
  });
  it("loads a language-tagged schema:name that has no jsched:summary", async () => {
    expect(await parse(`<#it> a s:Event; s:name "Lunch"@en; ${start}.`)).toMatchObject({
      name: "Lunch",
    });
  });
  it.each([
    ["language-tagged", `j:timeZone "Europe/London"@en`],
    ["duplicated", `j:timeZone "Europe/London", "Europe/London"@en`],
  ])("expands a series in the event zone when its time zone is %s", async (_label, zone) => {
    const body = (z: string) =>
      `<#it> a j:CalendarEvent; s:name "Weekly"; s:startDate "2026-03-02T09:00:00Z"^^xsd:dateTime; ${z}; j:recurrence [ j:frequency "WEEKLY"; j:count 8 ].`;
    const plain = await parse(body(`j:timeZone "Europe/London"`));
    const odd = await parse(body(zone));
    expect(odd?.timeZone).toBe("Europe/London");
    const range = [new Date("2026-03-01Z"), new Date("2026-05-01Z")] as const;
    expect(expandEvent(odd as NonNullable<typeof odd>, ...range, "America/New_York")).toEqual(
      expandEvent(plain as NonNullable<typeof plain>, ...range, "America/New_York"),
    );
    // A dropped zone would expand in the viewer's zone and move occurrences across DST weeks.
    expect(
      expandEvent(
        { ...(odd as NonNullable<typeof odd>), timeZone: undefined },
        ...range,
        "America/New_York",
      ),
    ).not.toEqual(expandEvent(plain as NonNullable<typeof plain>, ...range, "America/New_York"));
  });
});

describe("event field setters", () => {
  it("write through the generated view and read back", () => {
    const doc = new EventDoc(`${url}#it`, new Store(), DataFactory);
    doc.location = "Room";
    doc.description = "Notes";
    doc.uid = "u1";
    doc.timeZone = "Europe/London";
    expect([doc.location, doc.description, doc.uid, doc.timeZone]).toEqual([
      "Room",
      "Notes",
      "u1",
      "Europe/London",
    ]);
  });
});

describe("calendar documents", () => {
  const cal = async (body: string) =>
    parseCalendar(calUrl, await deserializeDataset(`${prefixes} ${body}`, calUrl));
  it.each([
    ["language-tagged", `dct:title "Work"@en`],
    ["duplicated", `dct:title "Work", "Other"@fr`],
  ])("lists a calendar whose title is %s", async (_label, title) => {
    const data = await cal(`<#it> a j:Calendar; ${title}.`);
    expect(["Work", "Other"]).toContain(data?.title);
  });
  it("keeps a tagged colour with a tagged title", async () => {
    expect(await cal(`<#it> a j:Calendar; dct:title "Work"@en; s:color "calendar"@en.`)).toEqual({
      title: "Work",
      color: "calendar",
    });
  });
  it("still rejects a calendar with no title and ignores other types", async () => {
    await expect(cal(`<#it> a j:Calendar.`)).rejects.toThrow("title");
    expect(await cal(`<#it> a s:Thing; dct:title "Nope".`)).toBeUndefined();
  });
  it("lists a calendar typed only with the legacy w3id class", async () => {
    expect(
      await cal(
        `<#it> a <https://w3id.org/jeswr/sectors/scheduling#Calendar>; dct:title "Legacy"; s:color "calendar".`,
      ),
    ).toEqual({ title: "Legacy", color: "calendar" });
  });
});

describe("one unreadable event does not hide the others", () => {
  const good = `${container}good.ttl`;
  const bad = `${container}bad.ttl`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const target = String(input);
    const turtle = (body: string) =>
      new Response(body, { headers: { "content-type": "text/turtle", etag: '"v1"' } });
    if (target === container)
      return turtle(
        `<${container}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${bad}>, <${good}>.`,
      );
    return turtle(
      target === bad
        ? `${prefixes} <#it> a s:Event; ${start}.`
        : `${prefixes} <#it> a s:Event; s:name "Fine"; ${start}.`,
    );
  });
  const range = [new Date("2026-03-01Z"), new Date("2026-03-10Z")] as const;
  it("skips the malformed event, reporting it when asked", async () => {
    const io = calendarIO(fetch, root);
    expect((await io.eventsInRange(container, ...range)).map((e) => e.url)).toEqual([good]);
    const seen = vi.fn();
    await io.eventsInRange(container, ...range, "UTC", seen);
    expect(seen).toHaveBeenCalledWith(
      bad,
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
  it("surfaces it as a calendar warning next to the readable events", async () => {
    const result = await loadRange(
      { webId: `${root}profile/card#me`, storageUrl: root, fetch },
      [{ url: calUrl, title: "Work", colour: "red", etag: null, container }],
      ...range,
      "UTC",
    );
    expect(result.events.map((e) => e.url)).toEqual([good]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.title).toContain(bad);
  });
});
