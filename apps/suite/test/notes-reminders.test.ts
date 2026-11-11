// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, OptionalAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentSubject } from "../src/apps/docs/lib/model/document";
import { writeRdf } from "../src/apps/docs/lib/model/rdf-io";
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
  createBrowserFiredStore,
  createMemoryFiredStore,
} from "../src/apps/notes/lib/reminders/fired-store";
import {
  createReminderScheduler,
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
    const id = doc.reminderId;
    expect(id).toMatch(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/);
    expect(parseNote(URL, data, "active")?.reminderId).toBe(id);
    expect(parseNote(URL, data, "active")?.reminder).toBe(ISO);
    expect(
      [...data.match(DataFactory.namedNode(`${URL}#reminder`))].map((q) => [
        q.predicate.value,
        q.object.value,
      ]),
    ).toEqual([
      [`${NS.RDF}type`, `${SCHED}Reminder`],
      [`${SCHED}triggerTime`, ISO],
      [`${NS.DCT}identifier`, id],
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
    expect(data.match(DataFactory.namedNode(`${URL}#reminder`)).size).toBe(3);
    expect(doc.reminderId).toBe(id);
    expect(() => {
      doc.reminder = new Date("invalid");
    }).toThrow("Invalid reminder date");
    doc.reminder = undefined;
    expect(doc.reminder).toBeUndefined();
    expect(doc.reminderId).toBeUndefined();
    expect(data.match(DataFactory.namedNode(`${URL}#reminder`)).size).toBe(0);
    expect(buildNote(URL, { title: "", reminder: null }).size).toBeGreaterThan(0);
    doc.reminder = NOW;
    expect(doc.reminderId).not.toBe(id);
    expect(parseNote(URL, buildNote(URL, { title: "", reminder: NOW }), "active")?.reminder).toBe(
      NOW.toISOString(),
    );
  });

  it("ignores missing, malformed or nonliteral triggers and non-IRI links", () => {
    const data = buildNote(URL, { title: "Remember", reminder: ISO });
    const doc = new NoteDoc(documentSubject(URL), data, DataFactory);
    const reminder = new TermWrapper(`${URL}#reminder`, data, DataFactory);
    OptionalAs.object(reminder, `${NS.DCT}identifier`, URL, (value) =>
      DataFactory.namedNode(value),
    );
    expect(doc.reminderId).toBeUndefined();
    doc.reminderId = undefined;
    expect(doc.reminderId).toBeUndefined();
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
    doc.reminderId = "ignored";
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
    const id = saved.reminderId;
    saved = await store.save(saved, { title: "Edited" }, saved.etag);
    expect(saved.reminder).toBe(ISO);
    saved = await store.archive(saved);
    expect(saved.reminder).toBe(ISO);
    expect((await store.read(saved.url))?.reminder).toBe(ISO);
    saved = await store.unarchive(saved);
    expect(saved.reminder).toBe(ISO);
    saved = await store.save(saved, { reminder: "2026-11-12T08:00:00Z" }, saved.etag);
    expect(saved.reminderId).toBe(id);
    expect((await store.read(saved.url))?.reminderId).toBe(id);
    expect(saved.reminder).toBe("2026-11-12T08:00:00.000Z");
    saved = await store.save(saved, { reminder: null }, saved.etag);
    expect(saved.reminder).toBeUndefined();
    expect(saved.reminderId).toBeUndefined();
    saved = await store.save(saved, { reminder: ISO }, saved.etag);
    expect(saved.reminderId).not.toBe(id);
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
  function fixture() {
    const fired = createMemoryFiredStore();
    const notify = vi.fn();
    return { fired, notify, scheduler: createReminderScheduler({ fired, notify }) };
  }
  const due = note({ reminder: NOW.toISOString() });
  it("fires once, survives scheduler reload and permits changed times", async () => {
    const s = fixture();
    await s.scheduler.tick([due], NOW.getTime());
    await s.scheduler.tick([due], NOW.getTime());
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(due);
    await createReminderScheduler({ fired: s.fired, notify: s.notify }).tick([due], NOW.getTime());
    expect(s.notify).toHaveBeenCalledTimes(1);
    await s.scheduler.tick(
      [note({ reminder: new Date(NOW.getTime() - 1).toISOString() })],
      NOW.getTime(),
    );
    expect(s.notify).toHaveBeenCalledTimes(2);
  });
  it("skips old, future, invalid and trashed reminders, deferring hidden delivery", async () => {
    const s = fixture();
    const notes = [
      due,
      note({ reminder: new Date(NOW.getTime() - DAY).toISOString() }),
      note(),
      note({ reminder: "invalid" }),
      note({ reminder: undefined }),
      note({ location: "trashed" }),
    ];
    await s.scheduler.tick(notes, NOW.getTime(), false);
    expect(s.notify).not.toHaveBeenCalled();
    await s.scheduler.tick(notes, NOW.getTime(), true);
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
  it("does not repeat after archive and unarchive, even if a collision renames the file", async () => {
    const pod = createDemoPod({ root: "https://pod.example/" });
    let now = NOW;
    const store = createNotesStore({
      podRoot: "https://pod.example/",
      webId: "https://pod.example/#me",
      fetch: pod.fetch,
      now: () => now,
    });
    await store.archive(await store.create({ title: "Reminder" }));
    now = new Date(NOW.getTime() + 1);
    const original = await store.create({ title: "Reminder", reminder: NOW.toISOString() });
    const s = fixture();
    await s.scheduler.tick([original], now.getTime());
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(original);
    const archived = await store.archive(original);
    expect(archived.url).toContain("reminder-2.ttl");
    await s.scheduler.tick([archived], now.getTime());
    const restored = await store.unarchive(archived);
    expect(restored.url).not.toBe(original.url);
    await createReminderScheduler({ fired: s.fired, notify: s.notify }).tick(
      [restored],
      now.getTime(),
    );
    expect(s.notify).toHaveBeenCalledTimes(1);
  });
  it("delivers distinct persisted reminders with colliding creation metadata", async () => {
    const s = fixture();
    const original = { ...due, reminderId: "first", created: NOW.toISOString(), creator: "alice" };
    const moved = { ...original, url: "https://pod.example/archived/renamed.ttl" };
    await s.scheduler.tick(
      [original, moved, { ...original, url: "second", reminderId: "second" }, due],
      NOW.getTime(),
    );
    expect(s.notify.mock.calls.map(([note]) => note)).toEqual([
      original,
      expect.objectContaining({ reminderId: "second" }),
      due,
    ]);
  });

  it("persists distinct IDs for resources created by the same author at the same time", async () => {
    const store = createNotesStore({
      podRoot: "https://pod.example/",
      webId: "https://pod.example/#me",
      fetch: createDemoPod({ root: "https://pod.example/" }).fetch,
    });
    const first = await store.create({ title: "Copy", reminder: NOW.toISOString() });
    const second = await store.create({ title: "Copy", reminder: NOW.toISOString() });
    expect(first.created).toBe(second.created);
    expect(first.creator).toBe(second.creator);
    expect(first.reminderId).toBeTruthy();
    expect(first.reminderId).not.toBe(second.reminderId);
    const s = fixture();
    await s.scheduler.tick([first, second], NOW.getTime());
    expect(s.notify).toHaveBeenCalledTimes(2);
  });

  it.each([
    "text save",
    "archive",
  ])("migrates a real legacy reminder claim before its first %s", async (action) => {
    const pod = createDemoPod({ root: "https://pod.example/" });
    const s = fixture();
    const store = createNotesStore({
      podRoot: "https://pod.example/",
      webId: "https://pod.example/#me",
      fetch: pod.fetch,
      fired: s.fired,
    });
    const data = buildNote(URL, { title: "Legacy", reminder: NOW, now: NOW });
    const doc = new NoteDoc(documentSubject(URL), data, DataFactory);
    doc.created = undefined;
    doc.reminderId = undefined;
    await writeRdf(URL, data, { createOnly: true, fetchImpl: pod.fetch });
    const legacy = (await store.read(URL)) as NonNullable<Awaited<ReturnType<typeof store.read>>>;
    expect(legacy.created).toBeUndefined();
    expect(legacy.reminderId).toBeUndefined();
    expect(
      data.match(
        DataFactory.namedNode(`${URL}#reminder`),
        DataFactory.namedNode(`${NS.DCT}identifier`),
      ).size,
    ).toBe(0);
    await s.scheduler.tick([legacy], NOW.getTime());
    const saved =
      action === "text save" ? await store.save(legacy, { title: "Edited" }, legacy.etag) : legacy;
    if (action === "text save") {
      expect(saved.reminderId).toBeTruthy();
      await s.scheduler.tick([saved], NOW.getTime());
    }
    const archived = await store.archive(saved);
    expect(archived.reminderId).toBeTruthy();
    await s.scheduler.tick([archived], NOW.getTime());
    const restored = await store.unarchive(archived);
    expect(restored.reminderId).toBe(archived.reminderId);
    await s.scheduler.tick([restored], NOW.getTime());
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(legacy);
  });

  it("falls back to distinct URLs for legacy reminders, accepting a repeat after a move", async () => {
    const s = fixture();
    await s.scheduler.tick([due, { ...due, url: "legacy-two" }], NOW.getTime());
    await s.scheduler.tick([{ ...due, url: "legacy-moved", location: "archived" }], NOW.getTime());
    expect(s.notify).toHaveBeenCalledTimes(3);
  });

  it("releases a successful claim when its delivery owner has disappeared", async () => {
    const fired = createMemoryFiredStore();
    const notify = vi.fn(() => false);
    await createReminderScheduler({ fired, notify }).tick([due], NOW.getTime());
    const delivered = vi.fn();
    await createReminderScheduler({ fired, notify: delivered }).tick([due], NOW.getTime());
    await createReminderScheduler({ fired, notify: delivered }).tick([due], NOW.getTime());
    expect(delivered).toHaveBeenCalledExactlyOnceWith(due);
  });
});

it("copies the browser's delivered legacy claim before the conditional save and retains it after failure", async () => {
  const account = "https://pod.example/#legacy-browser-save";
  const pod = createDemoPod({ root: "https://pod.example/" });
  const data = buildNote(URL, { title: "Legacy", reminder: NOW, now: NOW });
  new NoteDoc(documentSubject(URL), data, DataFactory).reminderId = undefined;
  await writeRdf(URL, data, { createOnly: true, fetchImpl: pod.fetch });
  const fired = createBrowserFiredStore(account);
  const notify = vi.fn();
  const scheduler = createReminderScheduler({ fired, notify });
  const store = createNotesStore({
    podRoot: "https://pod.example/",
    webId: account,
    fetch: pod.fetch,
  });
  const legacy = (await store.read(URL)) as NonNullable<Awaited<ReturnType<typeof store.read>>>;
  await scheduler.tick([legacy], NOW.getTime());
  const migrate = vi.fn().mockRejectedValue(new Error("migration failed"));
  const guarded = createNotesStore({
    podRoot: "https://pod.example/",
    webId: account,
    fetch: pod.fetch,
    fired: { ...fired, migrate },
  });
  await expect(guarded.save(legacy, { title: "Edited" }, legacy.etag)).rejects.toThrow(
    "migration failed",
  );
  expect(await store.read(URL)).toMatchObject({
    etag: legacy.etag,
    reminderId: undefined,
    title: "Legacy",
  });
  const saved = await store.save(legacy, { title: "Edited" }, legacy.etag);
  expect(migrate).toHaveBeenCalledTimes(1);
  await scheduler.tick([saved], NOW.getTime());
  // Exercise the store's default account-scoped browser history, too.
  const archived = await store.archive(saved);
  await scheduler.tick([archived], NOW.getTime());
  expect(notify).toHaveBeenCalledExactlyOnceWith(legacy);
});
