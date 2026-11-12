// AUTHORED-BY Codex (GPT-6.1 Sol)
import { discoverCalendars, loadRange } from "@/apps/calendar/state/repository";
import type { PodSession } from "@/lib/session/pod-session";

export async function readCalendarEvents(
  session: PodSession,
  range: { start: Date; end: Date },
  timeZone: string,
) {
  const discovery = await discoverCalendars(session);
  if (discovery.warnings.length) throw new Error("Some calendars could not be read");
  const result = await loadRange(session, discovery.calendars, range.start, range.end, timeZone);
  if (result.warnings.length) throw new Error("Some calendar events could not be read");
  return result.events;
}
