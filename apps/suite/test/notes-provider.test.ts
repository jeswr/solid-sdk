// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { NoteMoveBlockedError } from "../src/apps/notes/lib/model/errors";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { getPendingDrafts } from "../src/apps/notes/state/draft-registry";
import { NotesProvider, useNotesContext } from "../src/apps/notes/state/notes-context";
import { useNoteDraft } from "../src/apps/notes/state/use-note-draft";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  pathname: "/notes",
  query: new URLSearchParams(),
  push: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: { error: navigation.toastError },
}));
vi.mock("../src/apps/notes/components/share-note", () => ({
  ShareNote: ({ note }: { note: StoredNote }) =>
    h("div", { role: "dialog", "aria-label": "Share" }, note.url),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.query,
  useRouter: () => ({ push: navigation.push }),
}));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("history", window.history);
  history.replaceState({}, "");
  navigation.pathname = "/notes";
  navigation.query = new URLSearchParams();
  navigation.push.mockClear();
  navigation.toastError.mockClear();
});
afterEach(() => vi.useRealTimers());
async function fixture(children?: ReactNode) {
  const pod = createDemoPod({ root: "https://notes.example/" });
  const fetchImpl = vi.fn(pod.fetch);
  const session: PodSession = {
    mode: "demo",
    webId: "https://notes.example/profile/card#me",
    storageUrl: "https://notes.example/",
    displayName: "Notes",
    fetch: fetchImpl,
    subscribe: () => () => {},
    reset: async () => {},
  };
  let value!: ReturnType<typeof useNotesContext>;
  function Harness() {
    value = useNotesContext();
    return children ?? null;
  }
  const render = () => h(NotesProvider, { session, children: h(Harness) });
  const ui = await mount(render());
  await vi.waitFor(() =>
    expect(value.active.loading || value.archived.loading || value.trashed.loading).toBe(false),
  );
  return {
    get value() {
      return value;
    },
    fetchImpl,
    ui,
    render,
  };
}
it("keeps all three lists mounted across route and dialog navigation", async () => {
  const s = await fixture();
  let note!: Awaited<ReturnType<typeof s.value.create>>;
  await act(async () => {
    note = await s.value.create({ title: "Keep", body: "<p>A thought</p>" }, false, "default");
  });
  navigation.pathname = "/notes/label/Ideas%20%26%20plans";
  navigation.query = new URLSearchParams("q=words");
  await s.ui.render(s.render());
  const calls = s.fetchImpl.mock.calls.length;
  const opener = document.createElement("button");
  await act(() => s.value.openNote(note, opener));
  navigation.pathname = `/notes/n/${encodeRef(note.url)}`;
  await s.ui.render(s.render());
  expect(s.fetchImpl).toHaveBeenCalledTimes(calls);
  expect(history.state.from).toBe("/notes/label/Ideas%20%26%20plans?q=words");
  expect(s.value.opener.current).toBe(opener);
  await act(() => s.value.closeNote());
  expect(navigation.push).toHaveBeenLastCalledWith("/notes/label/Ideas%20%26%20plans?q=words", {
    scroll: false,
  });
  history.replaceState({ from: "https://untrusted.example/" }, "");
  await act(() => s.value.closeNote());
  expect(navigation.push).toHaveBeenLastCalledWith("/notes", { scroll: false });
});

it("keeps acknowledged text and ETags while the provider's list refresh is deferred", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-11T12:00:00Z") });
  let draft!: ReturnType<typeof useNoteDraft>;
  function Draft({ note }: { note: StoredNote }) {
    const context = useNotesContext();
    draft = useNoteDraft(
      note,
      context.store,
      context.refresh,
      getPendingDrafts(context.session.webId),
    );
    return null;
  }
  function Editor() {
    const note = useNotesContext().notes[0];
    return note ? h(Draft, { note }) : null;
  }
  const s = await fixture(h(Editor));
  let original!: StoredNote;
  await act(async () => {
    original = await s.value.create({ title: "Original", body: "Old body" }, false, "default");
  });
  const gate = deferred<void>();
  const list = s.value.store.list.bind(s.value.store);
  vi.spyOn(s.value.store, "list").mockImplementation(async (location) => {
    await gate.promise;
    return list(location);
  });
  const save = vi.spyOn(s.value.store, "save");
  vi.setSystemTime(Date.now() + 1000);
  await act(() => draft.change({ title: "Acknowledged", body: "New body" }));
  await act(() => draft.flush());
  expect(getPendingDrafts(s.value.session.webId).get(original.url)).toBeUndefined();
  expect(s.value.active.loading).toBe(true);
  expect(s.value.notes[0]?.etag).toBe(original.etag);
  expect(draft.draft).toEqual({ title: "Acknowledged", body: "New body", labels: [] });
  const acknowledged = await save.mock.results[0]?.value;
  await act(() => draft.change({ body: "Next edit during refresh" }));
  await act(() => draft.flush());
  expect(save.mock.calls[1]?.[2]).toBe(acknowledged.etag);
  expect(draft.status).toBe("saved");
  await act(() => gate.resolve());
  expect(s.value.active.loading).toBe(false);
  expect(draft.draft).toEqual({
    title: "Acknowledged",
    body: "Next edit during refresh",
    labels: [],
  });
  expect(await s.value.store.read(original.url)).toMatchObject(draft.draft);
});
it("carries pin and colour preferences through archive, trash and restore URL changes", async () => {
  const s = await fixture();
  let note!: Awaited<ReturnType<typeof s.value.create>>;
  await act(async () => {
    note = await s.value.create(
      { title: "Remember", body: "<p>Keep me</p>", labels: ["Ideas"] },
      true,
      "teal",
    );
  });
  expect(s.value.labels).toContain("Ideas");
  for (const action of ["archive", "unarchive", "trash", "restore"] as const) {
    const oldUrl = note.url;
    await act(async () => {
      note = await s.value.move(note, action);
    });
    expect(s.value.prefs.pinned).toContain(note.url);
    expect(s.value.prefs.pinned).not.toContain(oldUrl);
    expect(s.value.prefs.colours[note.url]).toBe("teal");
    expect(s.value.prefs.colours[oldUrl]).toBeUndefined();
    expect(s.value.notes.find((item) => item.url === note.url)?.body).toBe("<p>Keep me</p>");
  }
});

it("flushes an unmounted dialog's pending draft before a card moves its URL", async () => {
  const s = await fixture();
  let note!: Awaited<ReturnType<typeof s.value.create>>;
  await act(async () => {
    note = await s.value.create(
      { title: "Pending move", body: "<p>Pod copy</p>" },
      false,
      "default",
    );
  });
  const pending = getPendingDrafts(s.value.session.webId);
  await act(() => {
    pending.change(
      note,
      { title: "Latest title", body: "<p>Latest text</p>", labels: ["A"] },
      (...args) => s.value.store.save(...args),
    );
  });
  expect(s.value.notes.find((item) => item.url === note.url)?.title).toBe("Latest title");
  let moved!: typeof note;
  await act(async () => {
    moved = await s.value.move(note, "archive");
  });
  expect(moved).toMatchObject({ title: "Latest title", body: "<p>Latest text</p>", labels: ["A"] });
  expect(await s.value.store.read(moved.url)).toEqual({
    ...moved,
    readOnly: false,
    localGeneration: expect.any(Number),
  });
  expect(pending.get(note.url)).toBeUndefined();
  expect(s.value.notes.some((item) => item.url === note.url)).toBe(false);
});

it("keeps denied drafts locked through provider redraws and unlocks them after a fresh Write hint", async () => {
  let draft!: ReturnType<typeof useNoteDraft>;
  function Draft({ note }: { note: StoredNote }) {
    const context = useNotesContext();
    draft = useNoteDraft(
      note,
      context.store,
      context.refresh,
      getPendingDrafts(context.session.webId),
    );
    return null;
  }
  function Editor() {
    const note = useNotesContext().notes[0];
    return note ? h(Draft, { note }) : null;
  }
  const s = await fixture(h(Editor));
  let note!: StoredNote;
  await act(async () => {
    note = await s.value.create({ title: "Before" }, false, "default");
  });
  const transport = s.fetchImpl.getMockImplementation();
  expect(transport).toBeDefined();
  s.fetchImpl.mockImplementation(async (input, init) =>
    init?.method === "PUT" && String(input) === note.url
      ? new Response(null, { status: 403 })
      : (transport as typeof fetch)(input, init),
  );
  await act(() => draft.change({ title: "Recoverable" }));
  await act(() => draft.flush().catch(() => {}));
  const pending = getPendingDrafts(s.value.session.webId);
  expect(draft.viewOnly).toBe(true);
  const deniedCalls = s.fetchImpl.mock.calls.length;
  await act(() => pending.retry());
  await s.ui.render(s.render());
  expect(draft.viewOnly).toBe(true);
  expect(s.fetchImpl).toHaveBeenCalledTimes(deniedCalls);
  s.fetchImpl.mockImplementation(transport as typeof fetch);
  await act(() => s.value.refresh());
  expect(draft.viewOnly).toBe(false);
  await act(() => pending.retry());
  expect(pending.get(note.url)).toBeUndefined();
  expect((await s.value.store.read(note.url))?.title).toBe("Recoverable");
});

it.each([
  "archive",
  "trash",
] as const)("reports shared and unknown notes while batch %s moves unshared notes", async (action) => {
  const s = await fixture();
  let shared!: StoredNote;
  let unknown!: StoredNote;
  let unshared!: StoredNote;
  await act(async () => {
    shared = await s.value.create({ title: "Shared" }, true, "teal");
    unknown = await s.value.create({ title: "Unknown" }, false, "default");
    unshared = await s.value.create({ title: "Unshared" }, true, "yellow");
  });
  await writeRdf(`${shared.url}.acl`, privateAcl(shared.url, s.value.session.webId), {
    createOnly: true,
    fetchImpl: s.value.session.fetch,
  });
  const transport = s.fetchImpl.getMockImplementation();
  s.fetchImpl.mockImplementation((input, init) =>
    String(input) === `${unknown.url}.acl`
      ? Promise.resolve(new Response(null, { status: 403 }))
      : (transport as typeof fetch)(input, init),
  );
  s.fetchImpl.mockClear();
  let result!: Awaited<ReturnType<typeof s.value.moveMany>>;
  await act(async () => {
    result = await s.value.moveMany([shared, unknown, unshared], action);
  });
  expect(result.moved).toHaveLength(1);
  expect(result.moved[0]?.title).toBe("Unshared");
  expect(result.failed).toEqual([
    { url: shared.url, error: expect.any(NoteMoveBlockedError) },
    { url: unknown.url, error: expect.any(NoteMoveBlockedError) },
  ]);
  expect(s.value.prefs.pinned).toContain(shared.url);
  expect(s.value.prefs.colours[shared.url]).toBe("teal");
  expect(s.value.prefs.pinned).toContain(result.moved[0]?.url);
  expect(s.value.notes.map((note) => note.url)).toContain(shared.url);
  expect(s.value.notes.map((note) => note.url)).toContain(unknown.url);
  for (const [input, init] of s.fetchImpl.mock.calls) {
    if (init?.method === "DELETE") expect(String(input)).toBe(unshared.url);
    if (init?.method === "PUT") expect(String(input)).toBe(result.moved[0]?.url);
  }
  const alert = document.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(
    "Shared: Stop sharing this note before archiving or deleting it.",
  );
  expect(alert?.textContent).toContain("Unknown: Stop sharing");
  await click(alert?.querySelector("button") as HTMLButtonElement);
  expect(document.querySelector('[aria-label="Share"]')?.textContent).toBe(shared.url);
});

it("offers Share for a single refusal instead of retrying the move", async () => {
  const s = await fixture();
  let note!: StoredNote;
  await act(async () => {
    note = await s.value.create({ title: "Shared" }, false, "default");
  });
  await writeRdf(`${note.url}.acl`, privateAcl(note.url, s.value.session.webId), {
    createOnly: true,
    fetchImpl: s.value.session.fetch,
  });
  await act(() => s.value.attempt(() => s.value.move(note, "archive")));
  await vi.waitFor(() =>
    expect(navigation.toastError).toHaveBeenCalledWith(
      "Stop sharing this note before archiving or deleting it.",
      { action: { label: "Share", onClick: expect.any(Function) } },
    ),
  );
  const options = navigation.toastError.mock.calls.at(-1)?.[1];
  await act(() => options.action.onClick());
  expect(document.querySelector('[aria-label="Share"]')?.textContent).toBe(note.url);
});
