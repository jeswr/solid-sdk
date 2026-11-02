// AUTHORED-BY Codex GPT-6.1-Sol
import { type CalendarEvent, calendarIO, exportICal, importICal } from "../lib/model";
import type { CalendarAccount } from "./repository";
import type { CalendarInfo } from "./view";
export async function exportCalendar(
  account: CalendarAccount,
  calendar: CalendarInfo,
): Promise<string> {
  const io = calendarIO(account.fetch, account.storageUrl);
  const events = [];
  for (const url of await io.listResources(calendar.container)) {
    const item = await io.loadEvent(url);
    if (item) events.push(item);
  }
  return exportICal({ events });
}
/** Three workers bound pod writes; each event is attempted once and failures retain their titles. */
export async function importEvents(
  events: readonly CalendarEvent[],
  save: (event: CalendarEvent) => Promise<void>,
  progress: (done: number) => void,
): Promise<{ imported: number; failed: string[] }> {
  let cursor = 0;
  let done = 0;
  let imported = 0;
  const failed: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(3, events.length) }, async () => {
      while (cursor < events.length) {
        const event = events[cursor++] as CalendarEvent;
        try {
          await save(event);
          imported++;
        } catch {
          failed.push(event.name);
        }
        progress(++done);
      }
    }),
  );
  return { imported, failed };
}

/** The model cannot persist a TZID. Reject those series visibly instead of changing their zone. */
export function importCalendar(text: string, floatingTimeZone: string) {
  const parsed = importICal(text, floatingTimeZone);
  const events: CalendarEvent[] = [];
  const timeZones: (string | undefined)[] = [];
  parsed.events.forEach((event, index) => {
    const zone = parsed.timeZones[index];
    if (event.recurrence && zone !== undefined) {
      parsed.skipped++;
      parsed.warnings.push(
        `Skipped "${event.name}": recurring events in ${zone} cannot yet retain their timezone.`,
      );
    } else {
      events.push(event);
      timeZones.push(zone);
    }
  });
  return { ...parsed, events, timeZones };
}
