// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { buildNote } from "../src/apps/notes/lib/model/note";
import type { NotesStore, StoredNote } from "../src/apps/notes/lib/model/store";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { MemorySharingAdapter } from "../src/shell/share/memory-adapter";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mock = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  pathname: "/notes",
  session: {} as PodSession,
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mock.context }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => mock.pathname,
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mock.session }),
}));
vi.mock("../src/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/shell/share/verified-wac-adapter", async () => {
  const { MemorySharingAdapter } = await import("../src/shell/share/memory-adapter");
  return {
    VerifiedWacSharingAdapter: class extends MemorySharingAdapter {
      constructor() {
        super(
          {
            people: [{ webId: "https://pod.example/alice/#me", role: "owner" }],
            canManage: true,
            general: { mode: "restricted" },
          },
          0,
        );
      }
    },
    wacOnlyFetch: (fetch: typeof globalThis.fetch) => fetch,
  };
});
const { NoteCard } = await import("../src/apps/notes/components/note-card");
const { NoteDialog } = await import("../src/apps/notes/components/note-dialog");
const { ShareNote } = await import("../src/apps/notes/components/share-note");
const { SharedNote } = await import("../src/apps/notes/components/shared-note");
const { NotesApp } = await import("../src/apps/notes/components/notes-app");
const note: StoredNote = {
  url: "https://pod.example/alice/notes/ui.ttl",
  title: "Shared",
  body: "<p>Content</p>",
  labels: [],
  revisions: [],
  format: "text/html",
  location: "active",
  etag: '"one"',
};
const session = {
  mode: "demo",
  storageUrl: "https://pod.example/alice/",
  webId: "https://pod.example/alice/#me",
  fetch: vi.fn(),
} as unknown as PodSession;
const memory = () =>
  new MemorySharingAdapter(
    {
      people: [{ webId: session.webId, role: "owner" }],
      general: { mode: "restricted" },
      canManage: true,
    },
    0,
  );
function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text,
  );
  expect(element, text).toBeTruthy();
  return element as HTMLButtonElement;
}
beforeEach(() => {
  mock.pathname = "/notes";
  mock.session = session;
  for (const name of [
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "SVGElement",
    "DocumentFragment",
  ] as const)
    vi.stubGlobal(name, window[name]);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const save = vi.fn(async (note, input) => ({ ...note, ...input, etag: '"two"' }));
  mock.context = {
    session,
    store: {
      save,
      prepareSharing: vi.fn(async (value) => ({
        ...value,
        privatePreferences: "private",
        etag: '"prepared"',
      })),
    },
    attempt: (work: () => Promise<unknown>) => void work(),
    refresh: vi.fn(async () => {}),
    refreshSharing: vi.fn(),
    prefs: { pinned: [], colours: {} },
    labels: [],
    opener: { current: null },
  };
});
async function loaded() {
  await vi.waitFor(() => expect(document.body.textContent).toContain("People with access"));
}
it("uses the shell dialog with a memory adapter, WebID grants and an explicit image notice", async () => {
  const adapter = memory();
  const close = vi.fn();
  const prepared = vi.fn();
  const store = mock.context.store as NotesStore;
  await mount(
    h(ShareNote, { note, session, adapter, onClose: close, store, onPrepared: prepared }),
  );
  await loaded();
  expect(document.body.textContent).toContain("Images may also appear in other notes");
  expect(document.body.textContent).toContain("leaves image access in place");
  expect(prepared).toHaveBeenCalledOnce();
  const input = document.querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "https://pod.example/bob/#me",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await click(button("Add"));
  await vi.waitFor(async () =>
    expect((await adapter.load(note.url, new AbortController().signal)).people).toContainEqual({
      webId: "https://pod.example/bob/#me",
      role: "viewer",
    }),
  );
  expect(prepared).toHaveBeenCalledOnce();
  await click(button("Done"));
  expect(close).toHaveBeenCalledOnce();
});
it("opens Collaborator from the card menu and refreshes known grants on close", async () => {
  await mount(h(NoteCard, { note }));
  await click(button("More note actions"));
  await click(button("Collaborator"));
  await loaded();
  await click(button("Done"));
  expect(mock.context.refreshSharing).toHaveBeenCalledOnce();
  expect(mock.context.refresh).toHaveBeenCalledOnce();
});
it("flushes the editor before opening Collaborator and adopts the prepared note", async () => {
  const editing = { ...note, url: `${session.storageUrl}notes/editor-share.ttl` };
  await mount(h(NoteDialog, { note: editing }));
  const title = document.querySelector<HTMLInputElement>('[aria-label="Note title"]');
  expect(title).toBeTruthy();
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      title,
      "Latest title",
    );
    title?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Collaborator"));
  await loaded();
  expect((mock.context.store as NotesStore).save).toHaveBeenCalledOnce();
  expect((mock.context.store as NotesStore).prepareSharing).toHaveBeenCalledExactlyOnceWith({
    ...editing,
    title: "Latest title",
    etag: '"two"',
  });
  await click(button("Done"));
  expect(mock.context.refreshSharing).toHaveBeenCalledOnce();
});
it("supports untitled notes and the optional preference callback", async () => {
  const adapter = memory();
  const ui = await mount(
    h(ShareNote, { note: { ...note, title: "" }, session, adapter, onClose: vi.fn() }),
  );
  await loaded();
  expect(document.body.textContent).toContain("Untitled note");
  await ui.unmount();
  await mount(
    h(ShareNote, {
      note,
      session,
      adapter,
      store: mock.context.store as NotesStore,
      onClose: vi.fn(),
    }),
  );
  await loaded();
});
it("renders public shared notes through the anonymous read path without an editor writer", async () => {
  const url = "https://pod.example/bob/notes/shared.ttl";
  const media = "https://pod.example/bob/notes/media/image.png";
  const body = await serializeTurtle(
    buildNote(url, { title: "From Bob", body: `<p>Hello</p><img src="${media}" alt="A view">` }),
  );
  const fetch = vi.fn(async (input) =>
    String(input) === url
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : new Response(new Blob(["image"]), { headers: { "content-type": "image/png" } }),
  );
  vi.stubGlobal("fetch", fetch);
  await mount(h(SharedNote, { reference: encodeRef(url), podRoot: session.storageUrl }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("From Bob"));
  await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1));
  expect(document.querySelector('[aria-label="Note body"]')?.getAttribute("contenteditable")).toBe(
    "false",
  );
  expect(document.body.textContent).toContain("View only");
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: "omit" }));
  expect((mock.context.store as NotesStore).save).not.toHaveBeenCalled();
});
it("keeps shared link errors clear and fences a replaced or unmounted read", async () => {
  const first = deferred<Response>();
  const url = "https://pod.example/bob/notes/one.ttl";
  const second = "https://pod.example/bob/notes/two.ttl";
  const body = await serializeTurtle(buildNote(url, { title: "Old", body: "<p>Old</p>" }));
  const fetch = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const ui = await mount(h(SharedNote, { reference: encodeRef(url), podRoot: session.storageUrl }));
  expect(document.body.textContent).toContain("Opening shared note");
  await ui.render(h(SharedNote, { reference: encodeRef(second), podRoot: session.storageUrl }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("not supported yet"));
  await act(() =>
    first.resolve(new Response(body, { headers: { "content-type": "text/turtle" } })),
  );
  expect(document.body.textContent).not.toContain("Old");
  await ui.unmount();
});

it("renders an untitled shared note and ignores a failed read after unmount", async () => {
  const url = "https://pod.example/bob/notes/untitled.ttl";
  const response = await serializeTurtle(
    buildNote(url, { title: "", body: "<p>Untitled body</p>" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(response, { headers: { "content-type": "text/turtle" } })),
  );
  const ui = await mount(h(SharedNote, { reference: encodeRef(url), podRoot: session.storageUrl }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Untitled note"));
  await ui.unmount();
  const failure = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => failure.promise),
  );
  const pending = await mount(
    h(SharedNote, { reference: encodeRef(url), podRoot: session.storageUrl }),
  );
  await pending.unmount();
  await act(() => failure.reject(new Error("Offline")));
});

it("routes foreign note links to view only without mounting the owner's lists or registry", async () => {
  const url = "https://pod.example/bob/notes/routed.ttl";
  mock.pathname = `/notes/n/${encodeRef(url)}`;
  const body = await serializeTurtle(
    buildNote(url, { title: "Routed", body: "<p>Shared view</p>" }),
  );
  const fetch = vi.fn(
    async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  vi.stubGlobal("fetch", fetch);
  await mount(h(NotesApp, { children: null }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Routed"));
  expect(document.body.textContent).toContain("View only");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    url,
    expect.objectContaining({ credentials: "omit" }),
  );
});

it("shows an unsupported link state before any cross-origin fetch", async () => {
  mock.pathname = `/notes/n/${encodeRef("https://elsewhere.example/notes/no.ttl")}`;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await mount(h(NotesApp, { children: null }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "This note link isn't supported",
  );
  expect(fetch).not.toHaveBeenCalled();
});
