// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, OptionalAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentSubject } from "../src/apps/docs/lib/model/document";
import { NS } from "../src/apps/docs/lib/model/vocab";
import { buildNote, type Note, NoteDoc, parseNote, SCHED } from "../src/apps/notes/lib/model/note";
import { notesPreferencesSchema } from "../src/apps/notes/lib/model/prefs";
import { selectNotes } from "../src/apps/notes/lib/model/query";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import {
  formatReminder,
  reminderInput,
  reminderPreset,
} from "../src/apps/notes/lib/reminders/dates";
import {
  createReminderScheduler,
  MAX_FIRED_REMINDERS,
  MAX_REMINDER_DELAY,
} from "../src/apps/notes/lib/reminders/scheduler";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const URL = "https://pod.example/notes/reminder.ttl";
const ISO = "2026-11-11T20:00:00.000Z";
const NOW = new Date("2026-11-11T12:00:00Z");
const DAY = 86_400_000;
function note(input: Partial<Note> = {}): Note {
  return {
    url: URL,
    title: "Remember",
    body: "",
    labels: [],
    format: "text/html",
    revisions: [],
    location: "active",
    reminder: ISO,
    ...input,
  };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterEach(() => vi.useRealTimers());

describe("reminder RDF", () => {
  it("sets, changes and removes the named reminder and its triples", () => {
    const data = buildNote(URL, { title: "Remember", reminder: ISO });
    const doc = new NoteDoc(documentSubject(URL), data, DataFactory);
    expect(parseNote(URL, data, "active")?.reminder).toBe(ISO);
    expect(
      [...data.match(DataFactory.namedNode(`${URL}#reminder`))].map((q) => [
        q.predicate.value,
        q.object.value,
      ]),
    ).toEqual([
      [`${NS.RDF}type`, `${SCHED}Reminder`],
      [`${SCHED}triggerTime`, ISO],
    ]);
    expect(
      [
        ...data.match(
          DataFactory.namedNode(documentSubject(URL)),
          DataFactory.namedNode(`${SCHED}hasReminder`),
        ),
      ][0]?.object.value,
    ).toBe(`${URL}#reminder`);
    doc.reminder = new Date("2026-11-12T08:00:00Z");
    expect(doc.reminder?.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect(data.match(DataFactory.namedNode(`${URL}#reminder`)).size).toBe(2);
    expect(() => {
      doc.reminder = new Date("invalid");
    }).toThrow("Invalid reminder date");
    doc.reminder = undefined;
    expect(doc.reminder).toBeUndefined();
    expect(data.match(DataFactory.namedNode(`${URL}#reminder`)).size).toBe(0);
    expect(buildNote(URL, { title: "", reminder: null }).size).toBeGreaterThan(0);
    expect(parseNote(URL, buildNote(URL, { title: "", reminder: NOW }), "active")?.reminder).toBe(
      NOW.toISOString(),
    );
  });

  it("ignores missing, malformed or nonliteral triggers and non-IRI links", () => {
    const data = buildNote(URL, { title: "Remember", reminder: ISO });
    const doc = new NoteDoc(documentSubject(URL), data, DataFactory);
    const reminder = new TermWrapper(`${URL}#reminder`, data, DataFactory);
    for (const value of [
      undefined,
      DataFactory.namedNode(URL),
      DataFactory.literal(ISO),
      DataFactory.literal("2026-11-11", DataFactory.namedNode(`${NS.XSD}dateTime`)),
      DataFactory.literal("2026-99-99T25:99:00Z", DataFactory.namedNode(`${NS.XSD}dateTime`)),
      DataFactory.literal("2026-02-30T08:00:00Z", DataFactory.namedNode(`${NS.XSD}dateTime`)),
    ]) {
      OptionalAs.object(reminder, `${SCHED}triggerTime`, value, TermFrom.itself);
      expect(parseNote(URL, data, "active")?.reminder).toBeUndefined();
    }
    OptionalAs.object(doc, `${SCHED}hasReminder`, "malformed", LiteralFrom.string);
    expect(doc.reminder).toBeUndefined();
    doc.reminder = undefined;
    expect(doc.reminder).toBeUndefined();
  });

  it("preserves reminders across text saves, archive and unarchive; trash removes them permanently", async () => {
    const pod = createDemoPod({ root: "https://pod.example/" });
    const store = createNotesStore({
      podRoot: "https://pod.example/",
      webId: "https://pod.example/#me",
      fetch: pod.fetch,
    });
    let saved = await store.create({ title: "Reminder", reminder: ISO });
    saved = await store.save(saved, { title: "Edited" }, saved.etag);
    expect(saved.reminder).toBe(ISO);
    saved = await store.archive(saved);
    expect(saved.reminder).toBe(ISO);
    expect((await store.read(saved.url))?.reminder).toBe(ISO);
    saved = await store.unarchive(saved);
    expect(saved.reminder).toBe(ISO);
    saved = await store.save(saved, { reminder: "2026-11-12T08:00:00Z" }, saved.etag);
    expect(saved.reminder).toBe("2026-11-12T08:00:00.000Z");
    saved = await store.save(saved, { reminder: null }, saved.etag);
    expect(saved.reminder).toBeUndefined();
    saved = await store.save(saved, { reminder: ISO }, saved.etag);
    saved = await store.archive(saved);
    saved = await store.trash(saved);
    expect(saved.reminder).toBeUndefined();
    saved = await store.save(saved, { title: "In trash" }, saved.etag);
    expect(saved.reminder).toBeUndefined();
    saved = await store.restore(saved);
    expect(saved.location).toBe("archived");
    expect(saved.reminder).toBeUndefined();
  });
});

describe("local reminder dates (Europe/London)", () => {
  it("offers evening or next morning, tomorrow and the following Monday", () => {
    const cases = [
      ["today", "2026-11-11T17:59:59Z", "2026-11-11T20:00:00.000Z"],
      ["today", "2026-11-11T18:00:00Z", "2026-11-12T08:00:00.000Z"],
      ["tomorrow", "2026-12-31T22:00:00Z", "2027-01-01T08:00:00.000Z"],
      ["week", "2026-11-11T12:00:00Z", "2026-11-16T08:00:00.000Z"],
      ["week", "2026-11-16T07:00:00Z", "2026-11-23T08:00:00.000Z"],
      ["week", "2026-11-15T20:00:00Z", "2026-11-16T08:00:00.000Z"],
      ["tomorrow", "2026-03-28T12:00:00Z", "2026-03-29T07:00:00.000Z"],
      ["today", "2026-07-01T16:00:00Z", "2026-07-01T19:00:00.000Z"],
    ] as const;
    for (const [preset, current, expected] of cases) {
      const now = new Date(current);
      expect(reminderPreset(preset, now).toISOString()).toBe(expected);
      expect(now.toISOString()).toBe(new Date(current).toISOString());
    }
  });
  it("formats stable English calendar labels and local datetime inputs", () => {
    expect(formatReminder(ISO, new Date())).toBe("Today, 20:00");
    expect(formatReminder("2026-11-12T08:00:00Z", NOW)).toBe("Tomorrow, 08:00");
    expect(formatReminder("2026-11-13T08:05:00Z", NOW)).toBe("13 Nov, 08:05");
    expect(formatReminder("2027-01-01T00:01:00Z", NOW)).toBe("1 Jan 2027, 00:01");
    expect(formatReminder("2027-01-01T08:00:00Z", new Date("2026-12-31T20:00:00Z"))).toBe(
      "Tomorrow, 08:00",
    );
    expect(reminderInput("2026-07-02T07:05:00Z")).toBe("2026-07-02T08:05");
  });
});

describe("reminders selection", () => {
  it("groups active and archived reminders chronologically, ignoring pins and trash", () => {
    const notes = [
      note({ url: "late", reminder: "2026-11-15T08:00:00Z" }),
      note({ url: "old", reminder: "2026-11-01T08:00:00Z" }),
      note({ url: "soon", location: "archived" }),
      note({ url: "recent", reminder: NOW.toISOString() }),
      note({ url: "trash", location: "trashed" }),
      note({ url: "none", reminder: undefined }),
      note({ url: "bad", reminder: "invalid" }),
    ];
    const prefs = notesPreferencesSchema.parse({ pinned: ["late"] });
    const selection = selectNotes(notes, prefs, { location: "reminders", now: NOW.getTime() });
    expect(
      selection.sections?.map((section) => [section.title, section.notes.map((n) => n.url)]),
    ).toEqual([
      ["Upcoming", ["soon", "late"]],
      ["Past", ["recent", "old"]],
    ]);
    expect(selectNotes(notes, prefs, { location: "reminders" })).toEqual(selection);
  });
});

describe("reminder scheduler", () => {
  function fixture(initial: string | null = null) {
    const values = new Map<string, string>();
    if (initial !== null) values.set("suite.notes.reminders.fired.alice", initial);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const notify = vi.fn();
    return {
      values,
      storage,
      notify,
      scheduler: createReminderScheduler({ account: "alice", storage, notify }),
    };
  }
  const due = note({ reminder: NOW.toISOString() });
  it("fires once, survives reload and isolates accounts and changed times", () => {
    const s = fixture();
    s.scheduler.tick([due], NOW.getTime());
    s.scheduler.tick([due], NOW.getTime());
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(due);
    createReminderScheduler({ account: "alice", storage: s.storage, notify: s.notify }).tick(
      [due],
      NOW.getTime(),
    );
    expect(s.notify).toHaveBeenCalledTimes(1);
    createReminderScheduler({ account: "bob", storage: s.storage, notify: s.notify }).tick(
      [due],
      NOW.getTime(),
    );
    expect(s.notify).toHaveBeenCalledTimes(2);
    s.scheduler.tick(
      [note({ reminder: new Date(NOW.getTime() - 1).toISOString() })],
      NOW.getTime(),
    );
    expect(s.notify).toHaveBeenCalledTimes(3);
  });
  it("skips old, future, invalid and trashed reminders, deferring hidden delivery", () => {
    const s = fixture();
    const notes = [
      due,
      note({ reminder: new Date(NOW.getTime() - DAY).toISOString() }),
      note(),
      note({ reminder: "invalid" }),
      note({ reminder: undefined }),
      note({ location: "trashed" }),
    ];
    s.scheduler.tick(notes, NOW.getTime(), false);
    expect(s.notify).not.toHaveBeenCalled();
    s.scheduler.tick(notes, NOW.getTime(), true);
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(due);
    expect(s.scheduler.nextDelay(notes, NOW.getTime())).toBe(8 * 60 * 60_000);
    expect(
      s.scheduler.nextDelay(
        [
          due,
          note({ location: "trashed" }),
          note({ reminder: undefined }),
          note({ reminder: "bad" }),
        ],
        NOW.getTime(),
      ),
    ).toBe(MAX_REMINDER_DELAY);
    expect(s.scheduler.nextDelay([note({ reminder: "2027-11-11T08:00:00Z" })], NOW.getTime())).toBe(
      MAX_REMINDER_DELAY,
    );
  });
  it("handles corrupt, non-array and malformed records, prunes 30-day history and bounds writes", () => {
    for (const initial of ["{", "{}", '[null,{},[2,3],["bad","time"]]']) {
      const s = fixture(initial);
      s.scheduler.tick([due], NOW.getTime());
      expect(s.notify).toHaveBeenCalledTimes(1);
    }
    const records = Array.from({ length: MAX_FIRED_REMINDERS + 3 }, (_, i) => [
      `key-${i}`,
      NOW.getTime() - i,
    ]);
    records.push(["expired", NOW.getTime() - 30 * DAY], ["future", NOW.getTime() + 1]);
    const s = fixture(JSON.stringify(records));
    s.scheduler.tick([], NOW.getTime());
    const stored = JSON.parse([...s.values.values()][0] as string);
    expect(stored).toHaveLength(MAX_FIRED_REMINDERS);
    expect(stored.flat()).not.toContain("expired");
    expect(stored.flat()).not.toContain("future");
    expect(stored.at(-1)[0]).toBe("key-0");
  });
  it("continues and deduplicates in memory when storage reads and writes throw", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    const notify = vi.fn();
    const scheduler = createReminderScheduler({
      account: "alice",
      storage: { getItem: fail, setItem: fail },
      notify,
    });
    scheduler.tick([due], NOW.getTime());
    scheduler.tick([due], NOW.getTime());
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
