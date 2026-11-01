// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Writer } from "n3";
import {
  buildCalendar,
  buildEvent,
  CALENDAR_CLASS,
  type CalendarEvent,
  deserializeDataset,
  EVENT_CLASS,
  fromWallClock,
  NS,
  serializeDataset,
} from "../../apps/calendar/lib/model";
import { addDays, dateKey, localDate, PALETTE } from "../../apps/calendar/state/view";
import type { DemoSeedFile } from "./pod";
import { DEMO_ROOT } from "./seed";

/** Adds registered, useful calendar fixtures without replacing another app's index entries. */
export async function seedCalendar(files: DemoSeedFile[], now: number): Promise<DemoSeedFile[]> {
  const { namedNode: n, quad: q } = DataFactory;
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
      const reg = n(`${indexUrl}#calendar-${slug}-${predicate}`);
      index.add(q(reg, n(`${NS.RDF}type`), n(`${NS.SOLID}TypeRegistration`)));
      index.add(q(reg, n(`${NS.SOLID}forClass`), n(type)));
      index.add(q(reg, n(`${NS.SOLID}${predicate}`), n(value)));
    }
  }
  const timed = (day: string, time: string) =>
    fromWallClock(new Date(`${day}T${time}:00Z`), "Europe/London");
  const add = async (slug: string, id: string, data: CalendarEvent) => {
    const path = `calendar/${slug}/${id}.ttl`;
    out.push(
      makeFile(
        path,
        await serializeDataset(
          buildEvent(`${DEMO_ROOT}${path}`, {
            ...data,
            inCalendar: `${DEMO_ROOT}calendar/${slug}.ttl#it`,
          }),
        ),
      ),
    );
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
    start: addDays(monday, 2),
    end: addDays(monday, 5),
    location: "Ghent",
  });
  await add("personal", "evening", {
    name: "Dinner with friends",
    start: timed(today, "19:00"),
    end: timed(today, "21:00"),
    description: "Bring something to share.",
  });
  for (let i = 0; i < 6; i++)
    await add("personal", `busy-${i}`, {
      name: `Personal plan ${i + 1}`,
      start: timed(busyDay, `${String(13 + i).padStart(2, "0")}:00`),
      end: timed(busyDay, `${String(13 + i).padStart(2, "0")}:30`),
    });
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...index]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  out.push(makeFile(indexPath, body));
  return out;
}
