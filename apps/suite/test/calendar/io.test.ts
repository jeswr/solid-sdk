// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  buildCalendar,
  buildEvent,
  CalendarHttpError,
  calendarIO,
  deserializeDataset,
  NS,
  parseEvent,
  serializeDataset,
} from "../../src/apps/calendar/lib/model";

const root = "https://pod.example/";
const calendar = `${root}calendar/work.ttl`;
const container = `${root}calendar/work/`;
const url = `${container}e.ttl`;
const index = `${root}settings/index.ttl`;
const event = { name: "Test", start: new Date("2026-03-01T09:00Z") };
const rdf = (body: string, etag: string | null = '"v1"') =>
  new Response(body, {
    headers: { "content-type": "text/turtle", ...(etag === null ? {} : { etag }) },
  });
const mock = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  vi.fn<typeof fetch>(async (input, init) => handler(String(input), init ?? {}));

describe("injected calendar I/O", () => {
  it("loads typed calendars/events and carries ETags", async () => {
    const fetch = mock(async (target) =>
      rdf(
        await serializeDataset(
          target === calendar ? buildCalendar(calendar, { title: "Work" }) : buildEvent(url, event),
        ),
      ),
    );
    const io = calendarIO(fetch, root);
    expect(await io.loadCalendar(calendar)).toMatchObject({
      url: calendar,
      etag: '"v1"',
      data: { title: "Work" },
    });
    expect(await io.loadEvent(url)).toMatchObject({ url, etag: '"v1"', data: event });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Cache-Control")).toBe("no-cache");
    const empty = calendarIO(
      mock(() => rdf("")),
      root,
    );
    expect(await empty.loadCalendar(calendar)).toBeUndefined();
    expect(await empty.loadEvent(url)).toBeUndefined();
  });
  it("uses create-only and update preconditions and rejects unsafe replacements", async () => {
    const fetch = mock(() => new Response(null, { status: 201, headers: { etag: '"v2"' } }));
    const io = calendarIO(fetch, root);
    expect(await io.saveEvent(url, event, { create: true })).toBe('"v2"');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("If-None-Match")).toBe("*");
    await io.saveCalendar(calendar, { title: "Work" }, { etag: '"v1"' });
    const init = fetch.mock.calls[1]?.[1];
    expect(new Headers(init?.headers).get("If-Match")).toBe('"v1"');
    expect(new Headers(init?.headers).get("Content-Type")).toBe("text/turtle");
    const body = String(fetch.mock.calls[0]?.[1]?.body);
    expect(parseEvent(url, await deserializeDataset(body, url))).toMatchObject(event);
    for (const etag of ["", "*", 'W/"v1"'])
      await expect(io.saveEvent(url, event, { etag })).rejects.toThrow("ETag");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      await calendarIO(
        mock(() => new Response(null, { status: 201 })),
        root,
      ).saveEvent(url, event, { create: true }),
    ).toBeNull();
  });
  it("propagates read failures, write failures and precondition failures without overwriting", async () => {
    const io = calendarIO(
      mock(() => new Response(null, { status: 412, headers: { etag: '"new"' } })),
      root,
    );
    await expect(io.saveEvent(url, event, { etag: '"old"' })).rejects.toMatchObject({
      status: 412,
      etag: '"new"',
    });
    await expect(io.loadEvent(url)).rejects.toMatchObject({ status: 412 });
    expect(new CalendarHttpError(403, null).message).toContain("403");
  });
  it("requires conditional deletion", async () => {
    const fetch = mock(() => new Response(null, { status: 204 }));
    const io = calendarIO(fetch, root);
    await io.removeEvent(url, '"v1"');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"v1"' },
    });
    for (const etag of ["", "*", 'W/"v1"'])
      await expect(io.removeEvent(url, etag)).rejects.toThrow("ETag");
    await expect(
      calendarIO(
        mock(() => new Response(null, { status: 403 })),
        root,
      ).removeEvent(url, '"v1"'),
    ).rejects.toMatchObject({ status: 403, etag: null });
  });
  it("refuses out-of-pod targets, fragments, queries, containers and redirects", async () => {
    const fetch = mock(() => new Response(null, { status: 200 }));
    const io = calendarIO(fetch, root);
    for (const target of [
      "https://foreign.example/e",
      `${url}#it`,
      `${url}?x`,
      container,
      root,
      "https://pod.example/calendar/%2fescape",
    ])
      await expect(io.loadEvent(target)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const redirect = calendarIO(
      mock(
        () =>
          new Response(null, { status: 302, headers: { location: "https://foreign.example/e" } }),
      ),
      root,
    );
    await expect(redirect.loadEvent(url)).rejects.toThrow();
  });
  it("lists all resources before range expansion so earlier recurring series are included", async () => {
    const fetch = mock(async (target) => {
      if (target === container)
        return rdf(
          `<${container}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${url}>, <${container}empty.ttl>, <${container}later.ttl>, <${container}sub/>.`,
        );
      if (target.endsWith("empty.ttl")) return rdf("");
      return rdf(
        await serializeDataset(
          buildEvent(target, {
            ...event,
            start: new Date(
              target.endsWith("later.ttl") ? "2026-03-04T10:00Z" : "2026-02-25T09:00Z",
            ),
            recurrence: { frequency: "WEEKLY", count: 3 },
          }),
        ),
      );
    });
    const io = calendarIO(fetch, root);
    expect(await io.listResources(container)).toEqual([
      url,
      `${container}empty.ttl`,
      `${container}later.ttl`,
    ]);
    const events = await io.eventsInRange(
      container,
      new Date("2026-03-01Z"),
      new Date("2026-03-10Z"),
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.data.start).toEqual(new Date("2026-03-04T09:00Z"));
    expect(
      await calendarIO(
        mock(() => rdf("")),
        root,
      ).listResources(container),
    ).toEqual([]);
    await expect(
      calendarIO(
        mock(() =>
          rdf(
            `<${container}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <https://evil.example/e>.`,
          ),
        ),
        root,
      ).listResources(container),
    ).rejects.toThrow();
  });
  it("registers calendar and event classes idempotently, preserving unrelated RDF and legacy entries", async () => {
    let body = `<#incomplete> a <${NS.SOLID}TypeRegistration>. <${index}> a <${NS.SOLID}TypeIndex>. <#other> <${NS.DCT}title> "Keep me".`;
    let puts = 0;
    const fetch = mock((_target, init) => {
      if (init.method === "PUT") {
        puts++;
        expect(new Headers(init.headers).get("If-Match")).toBe('"v1"');
        body = String(init.body);
        return new Response(null, { status: 204 });
      }
      return rdf(body);
    });
    const io = calendarIO(fetch, root);
    expect(await io.registerCalendar(index, calendar, container)).toBe(2);
    expect(puts).toBe(1);
    expect(body).toContain("Keep me");
    expect(body).toContain(`${calendar}#it`);
    expect(await io.registerCalendar(index, calendar, container)).toBe(0);
    expect(puts).toBe(1);
    body = body.replaceAll(NS.SCHEDULING, "https://w3id.org/jeswr/sectors/scheduling#");
    expect(await io.registerCalendar(index, calendar, container)).toBe(0);
    await expect(
      calendarIO(
        mock(() => rdf("", null)),
        root,
      ).registerCalendar(index, calendar, container),
    ).rejects.toThrow("ETag");
  });
});
