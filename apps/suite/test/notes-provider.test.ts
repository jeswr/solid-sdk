// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { NotesProvider, useNotesContext } from "../src/apps/notes/state/notes-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  pathname: "/notes",
  query: new URLSearchParams(),
  push: vi.fn(),
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
});
async function fixture() {
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
    return null;
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
