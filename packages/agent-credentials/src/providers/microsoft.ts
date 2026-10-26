// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Microsoft calendar availability via Graph `calendarView` for ONE owner-selected calendar
 * (works for work/school and personal accounts; `getSchedule` does not support delegated personal
 * accounts). https://learn.microsoft.com/graph/api/calendar-list-calendarview
 *
 * Only `showAs`, `isAllDay`, `isCancelled`, `type`, `start`, `end` are requested. Conservative:
 * everything but `showAs: free` is busy; cancelled events are ignored; all-day events block the
 * owner's whole local day(s) and their literal interval. Fail closed:
 *  - paging follows `@odata.nextLink` only to the SAME calendarView operation (origin, path and
 *    requested window) — never another calendar or resource — without credentials in the URL,
 *    fragments or repeats, and at most GRAPH_MAX_PAGES pages;
 *  - date-times must be real wall-clock values; non-IANA zones, DST-skipped times and ranges that
 *    do not move forward block the source rather than being normalised into an interval.
 */
import { z } from "zod";
import {
  clip,
  failure,
  fetchJson,
  nextDate,
  ProviderCallError,
  type ProviderEnvironment,
  parseWallClock,
  type SourceResult,
  tokenFor,
  zonedToUtcChecked,
} from "./common.js";
import { isTimeZone, type Slot } from "./time.js";

export const GRAPH_ORIGIN = "https://graph.microsoft.com";
export const GRAPH_MIN_SCOPE = "Calendars.ReadBasic";
export const GRAPH_ACCEPTED_SCOPES = [
  "Calendars.ReadBasic",
  "Calendars.Read",
  "Calendars.ReadWrite",
];
export const GRAPH_PAGE_SIZE = 200;
export const GRAPH_MAX_PAGES = 20;
export const GRAPH_MAX_EVENTS = 5000;
const MAX_ALL_DAY_DAYS = 400;

const dateTimeTimeZone = z.object({
  dateTime: z.string().max(40),
  timeZone: z.string().max(100),
});
const eventSchema = z.object({
  showAs: z.string().max(40).nullish(),
  isAllDay: z.boolean().nullish(),
  isCancelled: z.boolean().nullish(),
  type: z.string().max(40).nullish(),
  start: dateTimeTimeZone,
  end: dateTimeTimeZone,
});
const pageSchema = z.object({
  value: z.array(z.unknown()).max(1000),
  "@odata.nextLink": z.string().max(4000).optional(),
});

type When = z.infer<typeof dateTimeTimeZone>;

/** A validated instant, or undefined (unreal components, non-IANA zone, DST-skipped time). */
function toInstant(v: When, prefer: "earliest" | "latest"): number | undefined {
  const w = parseWallClock(v.dateTime);
  if (!w) return undefined;
  if (v.timeZone === "UTC") return Date.parse(`${w.date}T00:00:00Z`) + w.minutes * 60_000 + w.ms;
  // Only IANA names are converted; Windows zone names are not guessed.
  if (!isTimeZone(v.timeZone) || !v.timeZone.includes("/")) return undefined;
  const t = zonedToUtcChecked(w.date, w.minutes, v.timeZone, prefer);
  return t === undefined ? undefined : t + w.ms;
}

function allDayBusy(e: z.infer<typeof eventSchema>, ownerTimeZone: string): Slot[] | string {
  const first = parseWallClock(e.start.dateTime);
  const last = parseWallClock(e.end.dateTime);
  const literalStart = toInstant(e.start, "earliest");
  const literalEnd = toInstant(e.end, "latest");
  if (!first || !last || literalStart === undefined || literalEnd === undefined)
    return "Microsoft all-day event with an unreadable date or time zone";
  if (last.date <= first.date || literalEnd <= literalStart)
    return "Microsoft all-day event does not end after it starts";
  const out: Slot[] = [
    { start: new Date(literalStart).toISOString(), end: new Date(literalEnd).toISOString() },
  ];
  // The owner's whole local day(s), whatever zone the provider used for the floating dates.
  let days = 0;
  for (let d = first.date; d < last.date; d = nextDate(d)) {
    if (++days > MAX_ALL_DAY_DAYS) return "Microsoft all-day event is implausibly long";
    const a = zonedToUtcChecked(d, 0, ownerTimeZone, "earliest");
    const b = zonedToUtcChecked(nextDate(d), 0, ownerTimeZone, "latest");
    if (a === undefined || b === undefined)
      return "the owner's local midnight does not exist on that day (DST); not guessed";
    out.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString() });
  }
  return out;
}

/** The next page must continue exactly this calendarView request, nothing else. */
function continuesSameRequest(
  next: string,
  path: string,
  window: Slot,
  seen: Set<string>,
): boolean {
  let u: URL;
  try {
    u = new URL(next);
  } catch {
    return false;
  }
  const decoded = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "\u0000";
    }
  };
  return (
    u.origin === GRAPH_ORIGIN &&
    u.username === "" &&
    u.password === "" &&
    u.hash === "" &&
    decoded(u.pathname) === decoded(path) &&
    u.searchParams.get("startDateTime") === window.start &&
    u.searchParams.get("endDateTime") === window.end &&
    !seen.has(u.toString())
  );
}

export async function microsoftCalendarView(
  env: ProviderEnvironment,
  input: {
    connectionId: string;
    calendarId: string;
    window: Slot;
    ownerTimeZone: string;
    /** Wall-clock deadline (ms epoch) of the caller's read budget; no page is started after it. */
    deadline?: number;
  },
  fetchedAt: () => string,
): Promise<SourceResult> {
  let token: string;
  try {
    token = await tokenFor(
      env,
      "microsoft",
      input.connectionId,
      [GRAPH_MIN_SCOPE],
      GRAPH_ACCEPTED_SCOPES,
    );
  } catch (error) {
    if (error instanceof ProviderCallError) return failure(error.status, error.message);
    return failure("blocked", "Microsoft token acquisition failed");
  }
  const path =
    input.calendarId === "primary"
      ? "/v1.0/me/calendar/calendarView"
      : `/v1.0/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView`;
  const params = new URLSearchParams({
    startDateTime: input.window.start,
    endDateTime: input.window.end,
  });
  params.set("$select", "showAs,isAllDay,isCancelled,type,start,end");
  params.set("$top", String(GRAPH_PAGE_SIZE));
  let url: string | undefined = `${GRAPH_ORIGIN}${path}?${params.toString()}`;
  const seen = new Set<string>([new URL(url).toString()]);
  const busy: Slot[] = [];
  let events = 0;
  let pages = 0;
  let ignored = 0;
  try {
    while (url) {
      if (++pages > GRAPH_MAX_PAGES)
        return failure(
          "blocked",
          `Microsoft calendar has more than ${GRAPH_MAX_PAGES} pages in the window`,
        );
      if (input.deadline !== undefined && Date.now() > input.deadline)
        return failure(
          "blocked",
          "not read completely: the time budget for provider reads was used up",
        );
      const body = await fetchJson(
        env,
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            prefer: 'outlook.timezone="UTC"',
          },
        },
        "Microsoft calendarView",
      );
      const page = pageSchema.safeParse(body);
      if (!page.success)
        return failure("blocked", "Microsoft calendarView: unexpected answer shape");
      for (const raw of page.data.value) {
        if (++events > GRAPH_MAX_EVENTS)
          return failure("blocked", `more than ${GRAPH_MAX_EVENTS} events in the window`);
        const e = eventSchema.safeParse(raw);
        if (!e.success) return failure("blocked", "Microsoft calendarView: unreadable event");
        const ev = e.data;
        // calendarView returns expanded occurrences; a series master here is unexpected data.
        if (ev.type === "seriesMaster")
          return failure("blocked", "Microsoft calendarView returned a series master (unexpected)");
        if (ev.isCancelled || ev.showAs === "free") {
          ignored++;
          continue;
        }
        if (ev.isAllDay) {
          const slots = allDayBusy(ev, input.ownerTimeZone);
          if (typeof slots === "string") return failure("blocked", slots);
          busy.push(...slots);
          continue;
        }
        const a = toInstant(ev.start, "earliest");
        const b = toInstant(ev.end, "latest");
        if (a === undefined || b === undefined)
          return failure(
            "blocked",
            "Microsoft event with an unreadable time, a non-IANA zone or a DST-skipped time (not guessed)",
          );
        if (b <= a) return failure("blocked", "Microsoft event ends before it starts");
        busy.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString() });
      }
      const next = page.data["@odata.nextLink"];
      if (next !== undefined) {
        if (!continuesSameRequest(next, path, input.window, seen))
          return failure(
            "blocked",
            "Microsoft paging link does not continue the selected calendar's request (refused)",
          );
        seen.add(new URL(next).toString());
      }
      url = next;
    }
  } catch (error) {
    if (error instanceof ProviderCallError) return failure(error.status, error.message);
    return failure("blocked", "Microsoft calendarView failed");
  }
  return {
    ok: true,
    busy: clip(busy, input.window),
    covered: { start: input.window.start, end: input.window.end },
    fetchedAt: fetchedAt(),
    detail: `Microsoft calendarView (${events} events on ${pages} page(s), ${ignored} free/cancelled ignored)`,
  };
}
