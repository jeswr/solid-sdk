/**
 * SYNTHETIC provider fixtures (no network): a fake `fetch` answering the Google freeBusy and
 * Microsoft Graph calendarView requests the adapters make, with invented events around the demo
 * week (19–28 October 2026, across the UK DST change on 25 October), and a fixture token
 * provider. Used by `--provider-fixtures` previews and by tests. Results are labelled
 * `mode: "fixture"` by the caller.
 */
import type { Slot } from "../../pilot/domains/scheduling.js";
import type { ProviderEnvironment } from "./common.js";
import type { AccessTokenProvider } from "./credentials.js";
import { GOOGLE_FREEBUSY_URL, GOOGLE_MIN_SCOPE } from "./google.js";
import { GRAPH_MIN_SCOPE, GRAPH_ORIGIN } from "./microsoft.js";

/** Calendars the fixtures know, for demo setup (provider calendar IDs are invented). */
export const FIXTURE_CALENDARS = [
  { provider: "google", providerCalendarId: "primary", label: "Google calendar (fixture)" },
  {
    provider: "google",
    providerCalendarId: "family-fixture@group.calendar.google.com",
    label: "Google shared family calendar (fixture)",
  },
  { provider: "microsoft", providerCalendarId: "primary", label: "Outlook calendar (fixture)" },
  {
    provider: "microsoft",
    providerCalendarId: "AAMkFixtureSecondary",
    label: "Outlook secondary calendar (fixture)",
  },
] as const;

const GOOGLE_BUSY: Record<string, Slot[]> = {
  primary: [
    { start: "2026-10-20T13:00:00Z", end: "2026-10-20T14:00:00Z" },
    { start: "2026-10-22T09:00:00Z", end: "2026-10-22T10:30:00Z" },
    { start: "2026-10-27T10:00:00Z", end: "2026-10-27T11:00:00Z" },
  ],
  "family-fixture@group.calendar.google.com": [
    { start: "2026-10-21T15:00:00Z", end: "2026-10-21T17:00:00Z" },
  ],
};

interface FixtureEvent {
  showAs: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  type: string;
  start: string;
  end: string;
  // Present in the fixture to prove the adapter never passes it on.
  subject?: string;
}

const utc = (dateTime: string) => ({ dateTime: `${dateTime}.0000000`, timeZone: "UTC" });

/** A daily 09:30 London stand-up (recurring; calendarView returns expanded occurrences). */
const standups: FixtureEvent[] = [
  ["2026-10-19T08:30:00", "2026-10-19T08:45:00"],
  ["2026-10-20T08:30:00", "2026-10-20T08:45:00"],
  ["2026-10-21T08:30:00", "2026-10-21T08:45:00"],
  ["2026-10-22T08:30:00", "2026-10-22T08:45:00"],
  ["2026-10-23T08:30:00", "2026-10-23T08:45:00"],
  // After the clocks change on 25 October, 09:30 London is 09:30 UTC.
  ["2026-10-26T09:30:00", "2026-10-26T09:45:00"],
  ["2026-10-27T09:30:00", "2026-10-27T09:45:00"],
  ["2026-10-28T09:30:00", "2026-10-28T09:45:00"],
].map(([s, e]) => ({
  showAs: "busy",
  type: "occurrence",
  start: s as string,
  end: e as string,
  subject: "Private stand-up",
}));

const GRAPH_EVENTS: Record<string, FixtureEvent[]> = {
  primary: [
    ...standups,
    {
      showAs: "busy",
      type: "singleInstance",
      start: "2026-10-20T08:00:00",
      end: "2026-10-20T08:30:00",
    },
    {
      showAs: "free",
      type: "singleInstance",
      start: "2026-10-21T10:00:00",
      end: "2026-10-21T11:00:00",
    },
    {
      showAs: "busy",
      isCancelled: true,
      type: "singleInstance",
      start: "2026-10-22T13:00:00",
      end: "2026-10-22T14:00:00",
    },
    {
      showAs: "tentative",
      type: "singleInstance",
      start: "2026-10-23T14:00:00",
      end: "2026-10-23T15:00:00",
    },
    {
      showAs: "oof",
      isAllDay: true,
      type: "singleInstance",
      start: "2026-10-28T00:00:00",
      end: "2026-10-29T00:00:00",
    },
  ],
  AAMkFixtureSecondary: [
    {
      showAs: "busy",
      type: "singleInstance",
      start: "2026-10-26T14:00:00",
      end: "2026-10-26T15:00:00",
    },
  ],
};

const FIXTURE_PAGE = 3;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const overlaps = (s: { start: string; end: string }, a: number, b: number) =>
  Date.parse(s.start) < b && a < Date.parse(s.end);

export const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (`${url.origin}${url.pathname}` === GOOGLE_FREEBUSY_URL && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as {
      timeMin: string;
      timeMax: string;
      items: { id: string }[];
    };
    const a = Date.parse(body.timeMin);
    const b = Date.parse(body.timeMax);
    return json({
      kind: "calendar#freeBusy",
      timeMin: body.timeMin,
      timeMax: body.timeMax,
      calendars: Object.fromEntries(
        body.items.map(({ id }) => [
          id,
          GOOGLE_BUSY[id]
            ? { busy: GOOGLE_BUSY[id].filter((s) => overlaps(s, a, b)) }
            : { errors: [{ domain: "global", reason: "notFound" }] },
        ]),
      ),
    });
  }
  if (url.origin === GRAPH_ORIGIN && url.pathname.endsWith("/calendarView")) {
    const m = /\/v1\.0\/me\/(?:calendar|calendars\/([^/]+))\/calendarView$/.exec(url.pathname);
    const id = m?.[1] ? decodeURIComponent(m[1]) : "primary";
    const events = GRAPH_EVENTS[id];
    if (!events)
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    const a = Date.parse(url.searchParams.get("startDateTime") ?? "");
    const b = Date.parse(url.searchParams.get("endDateTime") ?? "");
    const hits = events.filter((e) => overlaps({ start: `${e.start}Z`, end: `${e.end}Z` }, a, b));
    const page = Number(url.searchParams.get("fixturePage") ?? "0");
    const slice = hits.slice(page * FIXTURE_PAGE, (page + 1) * FIXTURE_PAGE);
    const more = (page + 1) * FIXTURE_PAGE < hits.length;
    const next = new URL(url);
    next.searchParams.set("fixturePage", String(page + 1));
    return json({
      value: slice.map((e) => ({ ...e, start: utc(e.start), end: utc(e.end) })),
      ...(more ? { "@odata.nextLink": next.toString() } : {}),
    });
  }
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
};

export const fixtureTokens: AccessTokenProvider = {
  async getAccessToken(request) {
    return {
      token: "fixture-access-token",
      grantedScopes: [request.provider === "google" ? GOOGLE_MIN_SCOPE : GRAPH_MIN_SCOPE],
    };
  },
};

export function fixtureProviders(): ProviderEnvironment {
  return { mode: "fixture", fetch: fixtureFetch, tokens: fixtureTokens };
}
