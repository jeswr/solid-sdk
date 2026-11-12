// AUTHORED-BY Codex GPT-6.1-Sol

import { ResourceGrantError } from "@jeswr/pod-auth";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { buildNote } from "../src/apps/notes/lib/model/note";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
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
  await mount(h(ShareNote, { note, session, adapter, onClose: close }));
  await loaded();
  expect(document.body.textContent).toContain("Images may also appear in other notes");
  expect(document.body.textContent).toContain(
    "Removing or reducing access also updates these images",
  );
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
  expect(mock.context.refresh).not.toHaveBeenCalled();
});
it("flushes the editor before opening Collaborator without rewriting note metadata", async () => {
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
  expect((mock.context.store as { save: ReturnType<typeof vi.fn> }).save).toHaveBeenCalledOnce();
  await click(button("Done"));
  expect(mock.context.refreshSharing).toHaveBeenCalledOnce();
});
it("supports untitled notes", async () => {
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
      onClose: vi.fn(),
    }),
  );
  await loaded();
});
it("lists only the owner's Notes images and shares them only after the owner's explicit action", async () => {
  const adapter = memory();
  const bob = "https://pod.example/bob/#me";
  const image = `${session.storageUrl}notes/media/listed.png`;
  const docs = `${session.storageUrl}docs/document/assets/other.png`;
  const outside = "https://pod.example/bob/notes/media/private.png";
  await adapter.setPerson(note.url, bob, "editor");
  const change = vi.spyOn(adapter, "setPerson");
  await mount(
    h(ShareNote, {
      note: {
        ...note,
        body: `<img src="${image}"><img src="${image}"><img src="${docs}"><img src="${outside}">`,
      },
      session,
      adapter,
      onClose: vi.fn(),
    }),
  );
  await loaded();
  const list = document.querySelector('[aria-label="Images to share"]');
  expect(list?.textContent).toBe(image);
  expect(list?.querySelectorAll("li")).toHaveLength(1);
  expect(document.body.textContent).toContain("Images added later need you to open Share again");
  expect(document.body.textContent).toContain(
    "Collaborators can see and edit this note's labels and reminders",
  );
  expect(change).not.toHaveBeenCalled();
  await click(button("Share listed images"));
  await vi.waitFor(async () =>
    expect((await adapter.load(image, new AbortController().signal)).people).toContainEqual({
      webId: bob,
      role: "viewer",
    }),
  );
  expect(change).toHaveBeenCalledExactlyOnceWith(image, bob, "viewer");
  expect((await adapter.load(docs, new AbortController().signal)).people).not.toContainEqual(
    expect.objectContaining({ webId: bob }),
  );
});
it("opens with grants disabled after an image read failure and still saves revocations", async () => {
  const adapter = memory();
  const bob = "https://pod.example/bob/#me";
  const image = `${session.storageUrl}notes/media/unreadable.png`;
  await adapter.setPerson(note.url, bob, "editor");
  await adapter.setGeneral(note.url, { mode: "link", role: "editor" });
  const original = adapter.load.bind(adapter);
  vi.spyOn(adapter, "load").mockImplementation(async (url, signal) => {
    if (url === image) throw new Error("Image policy unavailable");
    return original(url, signal);
  });
  const changes = vi.spyOn(adapter, "setPerson");
  await mount(
    h(ShareNote, {
      note: { ...note, body: `<img src="${image}">` },
      session,
      adapter,
      onClose: vi.fn(),
    }),
  );
  await loaded();
  expect(document.body.textContent).toContain("Image access couldn't be checked");
  expect(
    document.querySelector<HTMLFieldSetElement>('section[aria-label="Add people"] fieldset')
      ?.disabled,
  ).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>(
      'section[aria-label="Add people"] button[role="combobox"]',
    )?.disabled,
  ).toBe(true);
  expect(button("Add").disabled).toBe(true);
  expect(button("Share listed images").disabled).toBe(true);
  expect(button("Copy link").disabled).toBe(false);
  expect(changes).not.toHaveBeenCalled();
  async function open(label: string) {
    const element = [...document.querySelectorAll("label")].find(
      (item) => item.textContent === label,
    );
    const control = document.getElementById(element?.htmlFor ?? "") as HTMLButtonElement;
    expect(control.disabled).toBe(false);
    await act(() =>
      control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
  }
  function option(label: string) {
    const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.getAttribute("aria-label") === label || item.textContent === label,
    );
    expect(item, label).toBeTruthy();
    return item as HTMLElement;
  }
  await open(`Role for ${bob}`);
  expect(option("Viewer").getAttribute("aria-disabled")).not.toBe("true");
  await click(option("Viewer"));
  await vi.waitFor(async () =>
    expect((await original(note.url, new AbortController().signal)).people).toContainEqual({
      webId: bob,
      role: "viewer",
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(image),
  );
  await open(`Role for ${bob}`);
  expect(option("Editor").getAttribute("aria-disabled")).toBe("true");
  await click(option("Remove access"));
  await vi.waitFor(() => expect(document.querySelector(`li[aria-label="${bob}"]`)).toBeNull());
  expect(document.body.textContent).not.toContain("Undo");
  await open("General access role");
  await click(option("Viewer"));
  await vi.waitFor(async () =>
    expect((await original(note.url, new AbortController().signal)).general).toEqual({
      mode: "link",
      role: "viewer",
    }),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector('section[aria-label="General access"]')?.textContent,
    ).not.toContain("Saving"),
  );
  await open("General access role");
  expect(option("Editor").getAttribute("aria-disabled")).toBe("true");
  await act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await open("General access");
  await click(option("Restricted"));
  await vi.waitFor(async () =>
    expect((await original(note.url, new AbortController().signal)).general.mode).toBe(
      "restricted",
    ),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector('section[aria-label="General access"]')?.textContent,
    ).not.toContain("Saving"),
  );
  await open("General access");
  expect(option("Anyone with the link").getAttribute("aria-disabled")).toBe("true");
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
  expect((mock.context.store as { save: ReturnType<typeof vi.fn> }).save).not.toHaveBeenCalled();
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
  await vi.waitFor(() => expect(document.body.textContent).toContain("This note is private"));
  expect(document.body.textContent).not.toContain("Open with your account");
  await act(() =>
    first.resolve(new Response(body, { headers: { "content-type": "text/turtle" } })),
  );
  expect(document.body.textContent).not.toContain("Old");
  await ui.unmount();
});

it("opens a private shared note with the account only after the consent click", async () => {
  const url = "https://pod.example/bob/notes/private.ttl";
  const body = await serializeTurtle(buildNote(url, { title: "Secret", body: "<p>Hi</p>" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 401 })),
  );
  const accountFetch = vi.fn(
    async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  const grant = vi
    .fn<(url: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("no"))
    .mockRejectedValueOnce(new ResourceGrantError("no-user-activation"))
    .mockResolvedValue(undefined);
  await mount(
    h(SharedNote, {
      reference: encodeRef(url),
      podRoot: session.storageUrl,
      account: { fetch: accountFetch, grant },
    }),
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("This note is private"));
  expect(document.body.textContent).toContain("pod.example/bob/notes/private.ttl only");
  expect(accountFetch).not.toHaveBeenCalled();
  const button = () =>
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Open with your account"),
    ) as HTMLButtonElement;
  await click(button());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Couldn't open this note with your account."),
  );
  expect(accountFetch).not.toHaveBeenCalled();
  await click(button());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Click the button again to open it"),
  );
  await click(button());
  await vi.waitFor(() => expect(document.body.textContent).toContain("Secret"));
  expect(grant).toHaveBeenLastCalledWith(url);
  expect(accountFetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual" }));
  expect(document.body.textContent).toContain("View only");
});

it("tells a granted reader without access to ask the owner", async () => {
  const url = "https://pod.example/bob/notes/denied.ttl";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  const accountFetch = vi.fn(async () => new Response(null, { status: 403 }));
  const grant = vi.fn(async () => {});
  await mount(
    h(SharedNote, {
      reference: encodeRef(url),
      podRoot: session.storageUrl,
      account: { fetch: accountFetch, grant },
    }),
  );
  await vi.waitFor(() => expect(document.querySelectorAll("button")).toHaveLength(1));
  await click(document.querySelector("button") as HTMLButtonElement);
  await vi.waitFor(() => expect(document.body.textContent).toContain("Ask its owner"));
  expect(document.querySelectorAll("button")).toHaveLength(0);
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
