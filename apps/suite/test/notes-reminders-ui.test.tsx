// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  push: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({
  useNotesContext: () => mocks.context,
  NotesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/notes/reminders",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mocks.context.session }),
}));
vi.mock("../src/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children, sidebar }: { children: ReactNode; sidebar: ReactNode }) =>
    h("div", { id: "main-content" }, sidebar, children),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
const { NotesApp } = await import("../src/apps/notes/components/notes-app");
const { NotesGrid } = await import("../src/apps/notes/components/notes-grid");
const { NoteCard } = await import("../src/apps/notes/components/note-card");
const { NoteDialog } = await import("../src/apps/notes/components/note-dialog");
const { useNoteReminders, offerReminderPermission } = await import(
  "../src/apps/notes/state/reminders"
);
const { getPendingDrafts, createDraftRegistry } = await import(
  "../src/apps/notes/state/draft-registry"
);
// Route pages render null; the persistent layout picks the view from the pathname.
const RemindersPage = () => null;

const NOW = new Date("2026-11-11T12:00:00Z");
let serial = 0;
function note(input: Partial<StoredNote> = {}): StoredNote {
  return {
    url: `https://pod.example/notes/reminder-${++serial}.ttl`,
    title: "Remember",
    body: "<p>Body</p>",
    labels: [],
    location: "active",
    format: "text/html",
    revisions: [],
    etag: '"v1"',
    ...input,
  };
}
function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  expect(element, label).toBeDefined();
  return element as HTMLButtonElement;
}
async function fill(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  expect(element).toBeTruthy();
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      element,
      value,
    );
    element?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const resource = { loading: false, data: [], error: undefined };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  localStorage.clear();
  mocks.context = {
    prefs: { pinned: [], colours: {}, view: "grid" },
    session: {
      webId: `https://pod.example/#${++serial}`,
      storageUrl: "https://pod.example/",
      fetch: vi.fn(),
    },
    labels: [],
    pin: vi.fn(),
    colour: vi.fn(),
    opener: { current: null },
    closeNote: vi.fn(),
    openNote: vi.fn(),
    attempt: (work: () => Promise<unknown>) => {
      void work();
    },
    mutations: {
      save: vi.fn(async (saved, change) => ({
        ...saved,
        ...change,
        reminder: change.reminder ?? undefined,
        etag: '"v2"',
      })),
    },
    active: resource,
    archived: resource,
    trashed: resource,
    refresh: vi.fn(async () => {}),
    store: {
      containers: { active: "https://pod.example/notes/" },
      purgeTrash: vi.fn(async () => ({ deleted: [], failed: [] })),
    },
    notes: [],
  };
});
afterEach(() => {
  vi.useRealTimers();
});

it("sets and removes a card reminder, renders its chip and omits the control in Trash", async () => {
  const original = note();
  const save = vi.mocked((mocks.context.mutations as { save: ReturnType<typeof vi.fn> }).save);
  const ui = await mount(h(NoteCard, { note: original }));
  await click(button("Remind me"));
  await click(button("Later today"));
  expect(save).toHaveBeenCalledExactlyOnceWith(original, { reminder: "2026-11-11T20:00:00.000Z" });
  const saved = await save.mock.results[0]?.value;
  await ui.render(h(NoteCard, { note: saved }));
  expect(document.querySelector(".notes-reminder-chip")?.textContent).toBe("Today, 20:00");
  await click(button("Remind me"));
  await click(button("Remove reminder"));
  expect(save).toHaveBeenLastCalledWith(saved, { reminder: null });
  await ui.render(h(NoteCard, { note: await save.mock.results[1]?.value }));
  expect(document.querySelector(".notes-reminder-chip")).toBeNull();
  await ui.render(h(NoteCard, { note: { ...original, location: "trashed" } }));
  expect(document.querySelector('[aria-label="Remind me"]')).toBeNull();
});

it("picks a local date and time and displays an overdue chip", async () => {
  const original = note({ reminder: "2026-11-10T08:00:00Z" });
  const ui = await mount(h(NoteCard, { note: original }));
  expect(document.querySelector(".notes-reminder-chip")?.getAttribute("data-overdue")).toBe("true");
  await click(button("Remind me"));
  await click(button("Pick date & time"));
  expect(document.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe(
    "2026-11-10T08:00",
  );
  await fill("Reminder date and time", "2026-11-12T08:30");
  await click(button("Save"));
  expect((mocks.context.mutations as { save: ReturnType<typeof vi.fn> }).save).toHaveBeenCalledWith(
    original,
    { reminder: "2026-11-12T08:30:00.000Z" },
  );
  await ui.unmount();
});

it("flushes text before a dialog reminder change and uses the new ETag for the next text edit", async () => {
  const pod = createDemoPod({ root: "https://pod.example/" });
  const store = createNotesStore({
    podRoot: "https://pod.example/",
    webId: "https://pod.example/#me",
    fetch: pod.fetch,
  });
  const original = await store.create({ title: "Original", body: "<p>Body</p>" });
  const save = vi.spyOn(store, "save");
  let latest = original;
  mocks.context.store = store;
  mocks.context.mutations = {
    save: vi.fn(async (saved, change) => {
      latest = await store.save(saved, change, saved.etag);
      return latest;
    }),
  };
  const ui = await mount(h(NoteDialog, { note: original }));
  await fill("Note title", "Before reminder");
  await click(button("Remind me"));
  await click(button("Tomorrow"));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]?.[1]).toMatchObject({ title: "Before reminder" });
  expect(save.mock.calls[1]?.[0].title).toBe("Before reminder");
  expect(save.mock.calls[1]?.[1]).toEqual({ reminder: "2026-11-12T08:00:00.000Z" });
  await ui.render(h(NoteDialog, { note: latest }));
  expect(document.querySelector(".notes-reminder-chip")?.textContent).toBe("Tomorrow, 08:00");
  await fill("Note title", "After reminder");
  await click(button("Close"));
  expect(save).toHaveBeenCalledTimes(3);
  const persisted = await store.read(original.url);
  expect(persisted).toMatchObject({
    title: "After reminder",
    reminder: "2026-11-12T08:00:00.000Z",
  });
  expect(save.mock.calls[2]?.[2]).toBe(latest.etag);
  expect(mocks.toast.error).not.toHaveBeenCalled();
  const webId = (mocks.context.session as { webId: string }).webId;
  expect(getPendingDrafts(webId).get(original.url)).toBeUndefined();
  await ui.unmount();
  const reopened = await mount(h(NoteDialog, { note: persisted as StoredNote }));
  await click(button("Remind me"));
  await click(button("Remove reminder"));
  expect((await store.read(original.url))?.reminder).toBeUndefined();
  await reopened.unmount();
});

it("waits for a card reminder PUT before opening with the acknowledged ETag", async () => {
  const pod = createDemoPod({ root: "https://pod.example/" });
  const store = createNotesStore({
    podRoot: "https://pod.example/",
    webId: "https://pod.example/#me",
    fetch: pod.fetch,
  });
  const original = await store.create({ title: "Original" });
  const gate = deferred<void>();
  const save = vi.spyOn(store, "save");
  let latest = original;
  const reminderSave = vi.fn(async (saved, change) => {
    await gate.promise;
    latest = await store.save(saved, change, saved.etag);
    return latest;
  });
  mocks.context.store = store;
  mocks.context.mutations = { save: reminderSave };
  const ui = await mount(h(NoteCard, { note: original }));
  await click(button("Remind me"));
  await click(button("Tomorrow"));
  expect(button("Open Original").disabled).toBe(true);
  await click(button("Open Original"));
  expect(mocks.context.openNote).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve();
    await reminderSave.mock.results[0]?.value;
  });
  await ui.render(h(NoteCard, { note: latest }));
  expect(button("Open Original").disabled).toBe(false);
  await click(button("Open Original"));
  expect(mocks.context.openNote).toHaveBeenCalledWith(latest, expect.anything());
  await ui.render(h(NoteDialog, { note: latest }));
  await fill("Note title", "After card reminder");
  await click(button("Close"));
  expect(save.mock.calls[1]?.[2]).toBe(latest.etag);
  expect(await store.read(original.url)).toMatchObject({
    title: "After card reminder",
    reminder: "2026-11-12T08:00:00.000Z",
  });
  expect(mocks.toast.error).not.toHaveBeenCalled();
  await ui.unmount();
});

it("adopts refreshed reminder ETags in a clean dialog before the next text edit", async () => {
  const pod = createDemoPod({ root: "https://pod.example/" });
  const store = createNotesStore({
    podRoot: "https://pod.example/",
    webId: "https://pod.example/#me",
    fetch: pod.fetch,
  });
  const original = await store.create({ title: "Original" });
  mocks.context.store = store;
  const ui = await mount(h(NoteDialog, { note: original }));
  const latest = await store.save(original, { reminder: NOW.toISOString() }, original.etag);
  await ui.render(h(NoteDialog, { note: latest }));
  await fill("Note title", "After refresh");
  await click(button("Close"));
  expect(await store.read(original.url)).toMatchObject({
    title: "After refresh",
    reminder: NOW.toISOString(),
  });
  expect(mocks.context.closeNote).toHaveBeenCalled();
  await ui.unmount();
});

it("keeps reminders on the stored draft baseline when recovering, outside the text draft", async () => {
  const webId = "https://pod.example/#recover-reminder";
  const saved = note({ reminder: "2026-11-12T08:00:00.000Z" });
  const first = createDraftRegistry(webId, {
    storage: localStorage,
    tabId: "reminder-tab",
    now: () => NOW.getTime(),
  });
  first.change(saved, { title: "Changed", body: saved.body, labels: [] }, vi.fn());
  first.release();
  const recovered = createDraftRegistry(webId, {
    storage: localStorage,
    tabId: "reminder-tab",
    now: () => NOW.getTime(),
  });
  expect(recovered.get(saved.url)?.note.reminder).toBe(saved.reminder);
  expect(recovered.get(saved.url)?.draft).toEqual({
    title: "Changed",
    body: saved.body,
    labels: [],
  });
});

it("provides the Reminders route and sidebar link and groups upcoming and past cards", async () => {
  mocks.context.notes = [
    note({ title: "Later", reminder: "2026-11-15T08:00:00Z" }),
    note({ title: "Old", reminder: "2026-11-01T08:00:00Z" }),
    note({ title: "Archived soon", location: "archived", reminder: "2026-11-12T08:00:00Z" }),
    note({ title: "Recent", reminder: "2026-11-11T08:00:00Z" }),
    note({ title: "Trashed", location: "trashed", reminder: "2026-11-12T08:00:00Z" }),
    note({ title: "No reminder" }),
  ];
  await mount(h(NotesApp, { children: h(RemindersPage) }));
  expect(document.querySelector('a[href="/notes/reminders"]')?.getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.querySelector("h1")?.textContent).toBe("Reminders");
  const titles = (section: string) =>
    [...document.querySelectorAll(`section[aria-label="${section}"] h3`)].map(
      (el) => el.textContent,
    );
  expect(titles("Upcoming")).toEqual(["Archived soon", "Later"]);
  expect(titles("Past")).toEqual(["Recent", "Old"]);
  expect(document.querySelector('[aria-label="Take a note"]')).toBeNull();
  const recent = (mocks.context.notes as StoredNote[]).find((note) => note.title === "Recent");
  const reminderToast = mocks.toast.mock.calls.find((call) => call[0] === "Recent");
  expect(reminderToast).toBeDefined();
  await act(() => reminderToast?.[1].action.onClick());
  expect(mocks.context.openNote).toHaveBeenCalledWith(
    recent,
    document.getElementById("main-content"),
  );
});

it("moves a reminder to Past and mutes its chip as the clock advances", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const upcoming = note({ reminder: new Date(Date.now() + 30_000).toISOString() });
  mocks.context.notes = [upcoming];
  const ui = await mount(h(NotesGrid, { view: "reminders" }));
  expect(document.querySelector('section[aria-label="Upcoming"] h3')?.textContent).toBe("Remember");
  expect(document.querySelector(".notes-reminder-chip")?.getAttribute("data-overdue")).toBe(
    "false",
  );
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(document.querySelector('section[aria-label="Past"] h3')?.textContent).toBe("Remember");
  expect(document.querySelector(".notes-reminder-chip")?.getAttribute("data-overdue")).toBe("true");
  await ui.unmount();
});

function Scheduler({
  notes,
  account = "scheduler-ui",
  open,
}: {
  notes: StoredNote[];
  account?: string;
  open: (note: StoredNote) => void;
}) {
  useNoteReminders(account, notes, open);
  return null;
}

it("toasts a due reminder with Open, suppresses reload delivery, and picks up changed sources", async () => {
  const due = note({ reminder: NOW.toISOString() });
  const open = vi.fn();
  const ui = await mount(h(Scheduler, { notes: [due], open }));
  expect(mocks.toast).toHaveBeenCalledWith(
    "Remember",
    expect.objectContaining({ action: { label: "Open", onClick: expect.any(Function) } }),
  );
  const options = mocks.toast.mock.calls[0]?.[1];
  await act(() => options.action.onClick());
  expect(open).toHaveBeenCalledExactlyOnceWith(due);
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await ui.unmount();
  const reloaded = await mount(h(Scheduler, { notes: [due], open }));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await reloaded.render(
    h(Scheduler, {
      notes: [{ ...due, reminder: new Date(NOW.getTime() - 1000).toISOString() }],
      open,
    }),
  );
  expect(mocks.toast).toHaveBeenCalledTimes(2);
});

it("wakes at the due time", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const due = note({ reminder: new Date(Date.now() + 1000).toISOString() });
  const ui = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "timers" }));
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

it("checks every five minutes after a clock jump, before the next timeout", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const due = note({ reminder: new Date(Date.now() + 10 * 60_000).toISOString() });
  const ui = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "interval" }));
  vi.setSystemTime(Date.now() + 10 * 60_000);
  await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 - 1));
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("Remember", expect.anything());
  await ui.unmount();
});

it("cleans up timers and visibility listeners with an unfired reminder still scheduled", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const existingTimers = vi.getTimerCount();
  const due = note({ reminder: new Date(Date.now() + 60_000).toISOString() });
  const ui = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "cleanup" }));
  expect(vi.getTimerCount()).toBe(existingTimers + 2);
  await ui.unmount();
  expect(vi.getTimerCount()).toBe(existingTimers);
  await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
  const remainingTimers = vi.getTimerCount();
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(remainingTimers);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("atomically claims a reminder across two schedulers mounted before it becomes due", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const due = note({ reminder: new Date(Date.now() + 1000).toISOString() });
  const first = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "two-tabs" }));
  const second = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "two-tabs" }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await first.unmount();
  // A hidden, previously mounted tab must not erase the other tab's claim.
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await second.unmount();
  visibility.mockReturnValue("visible");
  const reloaded = await mount(h(Scheduler, { notes: [due], open: vi.fn(), account: "two-tabs" }));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await reloaded.unmount();
  visibility.mockRestore();
});

it("delivers once when React replays the scheduler mount effect", async () => {
  const due = note({ reminder: NOW.toISOString() });
  const ui = await mount(
    h(StrictMode, null, h(Scheduler, { notes: [due], open: vi.fn(), account: "strict-mode" })),
  );
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("Remember", expect.anything());
  await ui.unmount();
});

it("leaves hidden reminders unclaimed until visible, unless desktop notifications are granted", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const due = note({ reminder: NOW.toISOString() });
  const open = vi.fn();
  const ui = await mount(h(Scheduler, { notes: [due], open, account: "hidden" }));
  expect(mocks.toast).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await ui.unmount();
  visibility.mockReturnValue("hidden");
  let notification:
    | { title: string; onclick: () => void; close: ReturnType<typeof vi.fn> }
    | undefined;
  class DesktopNotification {
    static permission = "granted";
    close = vi.fn();
    onclick = () => {};
    constructor(public title: string) {
      notification = this;
    }
  }
  vi.stubGlobal("Notification", DesktopNotification);
  const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
  await mount(h(Scheduler, { notes: [due], open, account: "desktop" }));
  expect(mocks.toast).toHaveBeenCalledTimes(2);
  expect(notification?.title).toBe("Remember");
  await act(() => notification?.onclick());
  expect(open).toHaveBeenCalledWith(due);
  expect(notification?.close).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalled();
  visibility.mockRestore();
  focus.mockRestore();
  vi.stubGlobal("Notification", undefined);
});

it.each([
  "missing",
  "blocked",
])("deduplicates in page memory when IndexedDB is %s", async (mode) => {
  vi.stubGlobal(
    "indexedDB",
    mode === "missing"
      ? undefined
      : {
          open: () => {
            throw new Error("blocked");
          },
        },
  );
  const due = note({ reminder: NOW.toISOString() });
  const open = vi.fn();
  const account = `fallback-${mode}`;
  const ui = await mount(h(Scheduler, { notes: [due], open, account }));
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await ui.unmount();
  const reopened = await mount(h(Scheduler, { notes: [due], open, account }));
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  await reopened.render(h(Scheduler, { notes: [due], open, account: `${account}-other` }));
  expect(mocks.toast).toHaveBeenCalledTimes(2);
  await reopened.unmount();
});

it("offers notification permission once after a reminder, and handles browser refusals", async () => {
  const requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  offerReminderPermission("offer");
  offerReminderPermission("offer");
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  expect(requestPermission).not.toHaveBeenCalled();
  await act(() => mocks.toast.mock.calls[0]?.[1].action.onClick());
  expect(requestPermission).toHaveBeenCalledTimes(1);
  localStorage.setItem("suite.notes.reminders.prompted.before", "1");
  offerReminderPermission("before");
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  vi.stubGlobal("Notification", { permission: "denied" });
  offerReminderPermission("denied");
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      constructor() {
        throw new Error("unavailable");
      }
    },
  );
  await mount(
    h(Scheduler, {
      notes: [note({ title: "", reminder: NOW.toISOString() })],
      open: vi.fn(),
      account: "refused",
    }),
  );
  expect(mocks.toast).toHaveBeenLastCalledWith("Untitled note", expect.anything());
  vi.stubGlobal("Notification", undefined);
});
