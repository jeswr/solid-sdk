/**
 * Google Calendar availability via `freeBusy.query` (one request for up to 50 calendar IDs of one
 * account). https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
 *
 * Fail closed per calendar: a calendar missing from the answer, carrying `errors` (e.g.
 * `notFound`), or an answer whose `timeMin`/`timeMax` does not cover the requested window is
 * blocked. Only busy intervals are read (freeBusy returns nothing else).
 */
import { z } from "zod";
import type { Slot } from "../../pilot/domains/scheduling.js";
import {
  clip,
  failure,
  fetchJson,
  ProviderCallError,
  type ProviderEnvironment,
  parseRfc3339,
  type SourceResult,
  tokenFor,
} from "./common.js";

export const GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
export const GOOGLE_MIN_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const GOOGLE_ACCEPTED_SCOPES = [
  GOOGLE_MIN_SCOPE,
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar",
];
export const GOOGLE_MAX_CALENDARS = 50;

const rfc3339 = z
  .string()
  .max(40)
  .refine((v) => parseRfc3339(v) !== undefined, "not an RFC 3339 date-time");
const responseSchema = z.object({
  timeMin: rfc3339,
  timeMax: rfc3339,
  calendars: z.record(
    z.string().max(300),
    z.object({
      // Optional in the SCHEMA so that an entry carrying only `errors` parses; an entry with
      // neither errors nor a busy list is incomplete and blocks (below) — never read as free.
      busy: z
        .array(z.object({ start: rfc3339, end: rfc3339 }))
        .max(5000)
        .optional(),
      errors: z
        .array(z.object({ domain: z.string().max(100), reason: z.string().max(100) }))
        .max(20)
        .optional(),
    }),
  ),
});

/** Busy intervals per requested calendar ID (every requested ID gets an entry). */
export async function googleFreeBusy(
  env: ProviderEnvironment,
  input: { connectionId: string; calendarIds: readonly string[]; window: Slot },
  fetchedAt: () => string,
): Promise<Map<string, SourceResult>> {
  const out = new Map<string, SourceResult>();
  const failAll = (status: "blocked" | "needs-setup", reason: string) => {
    for (const id of input.calendarIds) out.set(id, failure(status, reason));
    return out;
  };
  if (input.calendarIds.length > GOOGLE_MAX_CALENDARS)
    return failAll("blocked", `more than ${GOOGLE_MAX_CALENDARS} Google calendars in one account`);
  let parsed: z.infer<typeof responseSchema>;
  try {
    const token = await tokenFor(
      env,
      "google",
      input.connectionId,
      [GOOGLE_MIN_SCOPE],
      GOOGLE_ACCEPTED_SCOPES,
    );
    const body = await fetchJson(
      env,
      GOOGLE_FREEBUSY_URL,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          timeMin: input.window.start,
          timeMax: input.window.end,
          timeZone: "UTC",
          items: input.calendarIds.map((id) => ({ id })),
        }),
      },
      "Google freeBusy",
    );
    const r = responseSchema.safeParse(body);
    if (!r.success) return failAll("blocked", "Google freeBusy: unexpected answer shape");
    parsed = r.data;
  } catch (error) {
    if (error instanceof ProviderCallError) return failAll(error.status, error.message);
    return failAll("blocked", "Google freeBusy failed");
  }
  const coversWindow =
    (parseRfc3339(parsed.timeMin) as number) <= Date.parse(input.window.start) &&
    (parseRfc3339(parsed.timeMax) as number) >= Date.parse(input.window.end);
  if (!coversWindow)
    return failAll("blocked", "Google freeBusy answered for a different time window");
  const at = fetchedAt();
  for (const id of input.calendarIds) {
    const c = parsed.calendars[id];
    if (!c) out.set(id, failure("blocked", `Google returned no data for calendar ${id}`));
    else if (c.errors && c.errors.length > 0)
      out.set(
        id,
        failure(
          c.errors.some((e) => e.reason === "notFound") ? "needs-setup" : "blocked",
          `Google reported ${c.errors.map((e) => e.reason).join(", ")} for this calendar`,
        ),
      );
    else if (!Array.isArray(c.busy))
      out.set(
        id,
        failure("blocked", "Google returned an incomplete entry (no busy list) for this calendar"),
      );
    else {
      const busy = c.busy;
      const bad = busy.some(
        (b) => (parseRfc3339(b.end) as number) <= (parseRfc3339(b.start) as number),
      );
      if (bad) out.set(id, failure("blocked", "Google returned a malformed busy interval"));
      else
        out.set(id, {
          ok: true,
          busy: clip(busy, input.window),
          covered: { start: input.window.start, end: input.window.end },
          fetchedAt: at,
          detail: `Google freeBusy (${busy.length} busy intervals)`,
        });
    }
  }
  return out;
}
