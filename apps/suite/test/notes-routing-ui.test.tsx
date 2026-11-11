// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { encodeRef } from "../src/lib/refs";
import { click, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  path: "/notes",
  context: {} as Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({
  useNotesContext: () => mocks.context,
  NotesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mocks.context.session }),
}));
vi.mock("../src/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/apps/notes/state/reminders", () => ({ useNoteReminders: () => {} }));
vi.mock("../src/apps/notes/components/sidebar", () => ({ NotesSidebar: () => null }));
vi.mock("../src/apps/notes/components/notes-grid", () => ({
  NotesGrid: () => h("div", { "data-notes-list": true }),
}));
vi.mock("../src/apps/notes/components/note-dialog", () => ({
  NoteDialog: ({ note }: { note: StoredNote }) => h("div", { role: "dialog" }, note.title),
}));
const { NotesApp } = await import("../src/apps/notes/components/notes-app");
const url = "https://alice.demo.pod/notes/idea.ttl";
const note = { url, title: "A saved idea" } as StoredNote;
const resource = { loading: false, data: [], error: undefined };

beforeEach(() => {
  mocks.path = `/notes/n/${encodeRef(url)}`;
  mocks.context = {
    notes: [],
    refresh: vi.fn(async () => {}),
    active: resource,
    archived: resource,
    trashed: resource,
    prefs: { view: "grid" },
    session: { webId: "https://alice.demo.pod/profile/card#me" },
    store: {
      containers: { active: "https://alice.demo.pod/notes/" },
      purgeTrash: vi.fn(async () => ({ deleted: [], failed: [] })),
    },
  };
});

it("shows a missing note without redirecting away from its address", async () => {
  const ui = await mount(h(NotesApp, { children: null }));
  expect(ui.host.querySelector("h1")?.textContent).toBe("Note not found");
  expect(ui.host.querySelector("a")?.getAttribute("href")).toBe("/notes");
  expect(ui.host.querySelector("[data-notes-list]")).toBeNull();
  mocks.path = "/notes/n/invalid!";
  await ui.render(h(NotesApp, { children: null }));
  expect(ui.host.querySelector('[data-category="not-found"]')).toBeTruthy();
});

it("waits for every folder before declaring a note missing and preserves load errors", async () => {
  mocks.context.archived = { ...resource, loading: true, data: undefined };
  const ui = await mount(h(NotesApp, { children: null }));
  expect(ui.host.querySelector('[data-category="not-found"]')).toBeNull();
  expect(ui.host.querySelector('[aria-busy="true"]')).toBeTruthy();
  expect(ui.host.querySelector("[data-notes-list]")).toBeNull();
  mocks.context.archived = { ...resource, error: new Error("Unavailable") };
  await ui.render(h(NotesApp, { children: null }));
  expect(ui.host.querySelector('[data-category="not-found"]')).toBeNull();
  expect(ui.host.querySelector('[data-category="unreachable"]')).toBeTruthy();
  await click(ui.host.querySelector('[data-category="unreachable"] button') as HTMLButtonElement);
  expect(mocks.context.refresh).toHaveBeenCalledOnce();
  mocks.context.archived = resource;
  await ui.render(h(NotesApp, { children: null }));
  expect(ui.host.querySelector('[data-category="not-found"]')).toBeTruthy();
});

it("keeps a moving note open until navigation completes, then forgets the old item", async () => {
  mocks.context.notes = [note];
  const ui = await mount(h(NotesApp, { children: null }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toBe("A saved idea");
  mocks.context.notes = [];
  await ui.render(h(NotesApp, { children: null }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toBe("A saved idea");
  mocks.path = "/notes";
  await ui.render(h(NotesApp, { children: null }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  mocks.path = `/notes/n/${encodeRef(url)}`;
  await ui.render(h(NotesApp, { children: null }));
  expect(ui.host.querySelector('[data-category="not-found"]')).toBeTruthy();
});
