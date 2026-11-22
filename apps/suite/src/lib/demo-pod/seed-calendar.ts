// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import {
  buildCalendar,
  buildEvent,
  CALENDAR_CLASS,
  type CalendarEvent,
  deserializeDataset,
  EVENT_CLASS,
  fromWallClock,
  serializeDataset,
} from "../../apps/calendar/lib/model";
import { addDays, dateKey, localDate, PALETTE } from "../../apps/calendar/state/view";
import { TypeRegistration } from "../../apps/docs/lib/model/type-index";
import type { DemoSeedFile } from "./pod";
import { DEMO_ROOT } from "./seed";

/** Adds registered, useful calendar fixtures without replacing another app's index entries. */
export async function seedCalendar(files: DemoSeedFile[], now: number): Promise<DemoSeedFile[]> {
  const today = dateKey(new Date(now));
  const monday = addDays(today, -((localDate(today).getDay() + 6) % 7));
  const busyDay = today;
  const indexPath = "settings/privateTypeIndex.ttl";
  const indexUrl = `${DEMO_ROOT}${indexPath}`;
  const indexFile = files.find((f) => f.path === indexPath) as DemoSeedFile;
  const index = await deserializeDataset(indexFile.body as string, indexUrl);
  const out = files.filter((f) => f.path !== indexPath);
  const makeFile = (path: string, body: string): DemoSeedFile => ({
    path,
    body,
    contentType: "text/turtle",
    modified: now,
  });
  for (const [slug, title, colour] of [
    ["personal", "Personal", PALETTE[0] as string],
    ["work", "Work", PALETTE[1] as string],
  ] as const) {
    const url = `${DEMO_ROOT}calendar/${slug}.ttl`;
    out.push(
      makeFile(
        `calendar/${slug}.ttl`,
        await serializeDataset(buildCalendar(url, { title, color: colour })),
      ),
    );
    out.push(makeFile(`calendar/${slug}/`, ""));
    for (const [type, predicate, value] of [
      [CALENDAR_CLASS, "instance", `${url}#it`],
      [EVENT_CLASS, "instanceContainer", `${DEMO_ROOT}calendar/${slug}/`],
    ] as const) {
      const reg = new TypeRegistration(
        `${indexUrl}#calendar-${slug}-${predicate}`,
        index,
        DataFactory,
      );
      reg.markRegistration();
      reg.forClass = type;
      reg[predicate] = value;
    }
  }
  const timed = (day: string, time: string) =>
    fromWallClock(new Date(`${day}T${time}:00Z`), "Europe/London");
  const add = async (slug: string, id: string, data: CalendarEvent) => {
    const path = `calendar/${slug}/${id}.ttl`;
    out.push({
      ...makeFile(
        path,
        await serializeDataset(
          buildEvent(`${DEMO_ROOT}${path}`, {
            ...data,
            inCalendar: `${DEMO_ROOT}calendar/${slug}.ttl#it`,
          }),
        ),
      ),
      search: {
        iri: `${DEMO_ROOT}${path}#it`,
        label: data.name ?? "Event",
        kind: "event",
        app: "calendar",
      },
    });
  };
  await add("work", "stand-up", {
    name: "Team stand-up",
    start: timed(monday, "09:30"),
    end: timed(monday, "09:45"),
    recurrence: { frequency: "WEEKLY", byDay: ["MO", "WE", "FR"] },
    location: "Team room",
    description: "Share progress and plans for the day.",
    reminders: [{ triggerOffset: "-PT15M" }],
  });
  await add("work", "planning", {
    name: "Project planning",
    start: timed(busyDay, "11:00"),
    end: timed(busyDay, "12:00"),
    location: "Studio",
  });
  await add("work", "design", {
    name: "Design review",
    start: timed(busyDay, "11:30"),
    end: timed(busyDay, "12:30"),
  });
  await add("personal", "day-off", {
    name: "A day for myself",
    start: today,
    end: addDays(today, 1),
  });
  await add("personal", "trip", {
    name: "Three-day trip",
    start: today,
    end: addDays(today, 3),
    location: "Ghent",
  });
  await add("personal", "evening", {
    name: "Dinner with friends",
    start: timed(today, "19:00"),
    end: timed(today, "21:00"),
    description: "Bring something to share.",
  });
  const plans = ["Gym", "Call Mum", "Dentist", "Groceries", "Piano lesson", "Read in the park"];
  for (const [i, name] of plans.entries())
    await add("personal", `busy-${i}`, {
      name,
      start: timed(busyDay, `${String(13 + i).padStart(2, "0")}:00`),
      end: timed(busyDay, `${String(13 + i).padStart(2, "0")}:30`),
    });
  out.push(makeFile(indexPath, await serializeDataset(index)));
  return out;
}
