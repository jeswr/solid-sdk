// AUTHORED-BY Codex GPT-6.1-Sol
import { type CalendarEvent, calendarIO, exportICal } from "../lib/model";
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
