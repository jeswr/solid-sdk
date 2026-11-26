// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import type { ScopedGrantSnapshot } from "@jeswr/pod-access/roles";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { ShareDialog } from "../src/apps/drive/components/share-dialog";
import { ScopedSharing, scopesMatch } from "../src/apps/drive/components/share-scoped";
import {
  applyScopedSharing,
  loadScopedSharing,
  loadSharing,
  ScopedSharingIncompleteError,
  type ScopedSharingSnapshot,
  SharingConflictError,
  SharingRefreshError,
  type SharingSession,
  type SharingSnapshot,
} from "../src/apps/drive/lib/sharing/adapter";
import { SharingError } from "../src/apps/drive/lib/sharing/rdf";
import type { SharingState } from "../src/apps/drive/lib/sharing/types";
import { ALICE, BOB, CAROL } from "./sharing-fixtures";

vi.mock("../src/apps/drive/lib/sharing/adapter", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/sharing/adapter")>()),
  loadSharing: vi.fn(),
  loadScopedSharing: vi.fn(),
  applyScopedSharing: vi.fn(),
  isPartialScope: (error: unknown) => error === partial,
}));
const load = vi.mocked(loadSharing);
const loadScoped = vi.mocked(loadScopedSharing);
const apply = vi.mocked(applyScopedSharing);
const FOLDER = "https://example.org/drive/drop/";
const source = `${FOLDER}.acl`;
const person = (
  webId: string,
  role: SharingState["people"][number]["role"],
  inherited = false,
) => ({
  webId,
  role,
  inherited,
  explicit: !inherited,
  sources: [source],
});
const general = { inherited: false, explicit: false, sources: [] };
const folder: SharingState = {
  people: [person(ALICE, "owner")],
  link: "none",
  public: "none",
  general,
};
const contents: SharingState = {
  people: [person(ALICE, "owner"), person(BOB, "viewer")],
  link: "none",
  public: "none",
  general,
};
function scoped(next: Partial<ScopedSharingSnapshot> = {}): ScopedSharingSnapshot {
  const grants = {
    url: FOLDER,
    folder: [],
    contents: [],
    version: "t",
  } as unknown as ScopedGrantSnapshot;
  return {
    resource: FOLDER,
    grants,
    folder,
    contents,
    canManage: true,
    ownsContents: true,
    ...next,
  };
}
// Hoisted for the adapter mock: the SDK brands its partial-scope errors.
const { partial } = vi.hoisted(() => ({ partial: new Error("different sharing") }));
const session: SharingSession = { fetch, webId: ALICE, storageUrl: "https://example.org/" };
const onSaved = vi.fn();
const onClose = vi.fn();
function show(disabledReason?: string) {
  return render(
    <ShareDialog
      item={{ name: "drop", url: FOLDER }}
      session={session}
      link="/drive/p/drop"
      onClose={onClose}
      onSaved={onSaved}
      disabledReason={disabledReason}
    />,
  );
}
async function editor() {
  await screen.findByRole("region", { name: "Items inside" });
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockRejectedValue(partial);
  loadScoped.mockResolvedValue(scoped());
});
afterEach(cleanup);

it("compares scopes by people, roles and general access", () => {
  expect(scopesMatch(scoped())).toBe(false);
  expect(scopesMatch(scoped({ contents: folder }))).toBe(true);
  expect(scopesMatch(scoped({ contents: { ...folder, link: "viewer", public: "viewer" } }))).toBe(
    false,
  );
});

const selected = (selection: { folder: unknown; contents: unknown }) =>
  scoped({
    folder: selection.folder as SharingState,
    contents: selection.contents as SharingState,
  });
const saves = async (
  _session: SharingSession,
  _snapshot: ScopedSharingSnapshot,
  selection: { folder: unknown; contents: unknown },
) => ({ snapshot: selected(selection), changed: true });
const ordinary = {
  resource: FOLDER,
  grants: { url: FOLDER, grants: [], version: "t" },
  state: folder,
  canManage: true,
  contentsDiffer: false,
} as unknown as SharingSnapshot;

it("opens the scope-aware editor for a folder shared differently inside, and changes each scope", async () => {
  apply.mockImplementation(saves);
  show();
  await editor();
  expect(screen.getByRole("note").textContent).toContain("shared differently");
  const inside = within(screen.getByRole("region", { name: "Items inside" }));
  const own = within(screen.getByRole("region", { name: "This folder" }));
  expect(inside.getByText(`${ALICE} (you)`)).toBeTruthy();
  const owner = inside.getByLabelText(`Role for ${ALICE} on items inside`) as HTMLSelectElement;
  expect(owner.disabled).toBe(true);
  // A locked row says why.
  const why = document.getElementById(owner.getAttribute("aria-describedby") as string);
  expect(why?.textContent).toBe("Owner access can't be changed here.");
  fireEvent.change(inside.getByLabelText(`Role for ${BOB} on items inside`), {
    target: { value: "editor" },
  });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]?.[2]).toEqual({
    folder,
    contents: { ...contents, people: [person(ALICE, "owner"), person(BOB, "editor")] },
  });
  await screen.findByText("Sharing saved");
  expect(onSaved).toHaveBeenCalledTimes(1);
  // Going public starts as viewer, with the public-link warning; editor is a second choice.
  expect(own.queryByLabelText("Link role for this folder")).toBeNull();
  fireEvent.change(own.getByLabelText("General access for this folder"), {
    target: { value: "anyone" },
  });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1]?.[2].folder).toMatchObject({ link: "viewer", public: "viewer" });
  const shared = within(await screen.findByRole("region", { name: "This folder" }));
  await waitFor(() =>
    expect(shared.getByText(/Anyone can access this folder without signing in/)).toBeTruthy(),
  );
  fireEvent.change(shared.getByLabelText("Link role for this folder"), {
    target: { value: "editor" },
  });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
  expect(apply.mock.calls[2]?.[2].folder).toMatchObject({ link: "editor", public: "viewer" });
  fireEvent.change(
    within(screen.getByRole("region", { name: "This folder" })).getByLabelText(
      "General access for this folder",
    ),
    { target: { value: "restricted" } },
  );
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(4));
  expect(apply.mock.calls[3]?.[2].folder).toMatchObject({ link: "none", public: "none" });
  fireEvent.click(
    within(screen.getByRole("region", { name: "Items inside" })).getByRole("button", {
      name: `Remove access for ${BOB} on items inside`,
    }),
  );
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(5));
  expect(apply.mock.calls[4]?.[2].contents.people).toEqual([person(ALICE, "owner")]);
});

it("makes the scopes match either way, then hands back to the ordinary dialog", async () => {
  apply.mockImplementation(saves);
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make this folder match items inside" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]?.[2]).toEqual({ folder: contents, contents });
  // Matching scopes reload the ordinary dialog.
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  load.mockResolvedValue(ordinary);
  cleanup();
  load.mockRejectedValueOnce(partial);
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1]?.[2]).toEqual({ folder, contents: folder });
  await screen.findByRole("region", { name: "People with access" });
  // The ordinary dialog carries on the editor's announcement.
  expect(screen.getByText("Sharing saved")).toBeTruthy();
});

it("shows inherited access as read-only, and a viewer's read-only state", async () => {
  loadScoped.mockResolvedValue(
    scoped({
      canManage: false,
      folder: { ...folder, people: [person(BOB, "viewer", true)] },
      contents: {
        ...contents,
        people: [],
        link: "viewer",
        public: "viewer",
        general: { inherited: true, explicit: false, sources: [`${"https://example.org/"}.acl`] },
      },
    }),
  );
  show();
  await editor();
  expect(screen.getByText(/Only an owner with Control can change sharing/)).toBeTruthy();
  const own = within(screen.getByRole("region", { name: "This folder" }));
  expect(own.getByText(/Inherited from .*Change access at the source/)).toBeTruthy();
  const inside = within(screen.getByRole("region", { name: "Items inside" }));
  expect(inside.getByText("No people have access.")).toBeTruthy();
  expect(inside.getByText(/Change general access at the source/)).toBeTruthy();
  expect(
    (inside.getByLabelText("General access for items inside") as HTMLSelectElement).disabled,
  ).toBe(true);
  for (const button of screen.getAllByRole("button", { name: /^Make / }))
    expect((button as HTMLButtonElement).disabled).toBe(true);
});

it("keeps edits disabled while a read-only reason applies, and ignores saves", async () => {
  show("Sharing is paused while files upload.");
  await editor();
  const match = screen.getByRole("button", { name: "Make items inside match this folder" });
  expect((match as HTMLButtonElement).disabled).toBe(true);
  // A forced click on a disabled control still never saves.
  fireEvent.click(match);
  expect(apply).not.toHaveBeenCalled();
});

it("reports load and save failures, and reloads on request", async () => {
  loadScoped.mockRejectedValueOnce(new SharingError("Couldn't load sharing. Try again."));
  show();
  await screen.findByText("Couldn't load sharing. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await editor();
  const match = () =>
    fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  apply.mockRejectedValueOnce(new SharingConflictError());
  match();
  await screen.findByText(/Sharing changed since you opened it/);
  expect(screen.getByText("Sharing not saved")).toBeTruthy();
  // A stale save changed nothing, so the listing isn't refreshed.
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await editor();
  // A refusal before any request keeps the controls and refreshes nothing.
  apply.mockRejectedValueOnce(new SharingError("Owner rows are read-only"));
  match();
  await screen.findByText("Owner rows are read-only");
  expect(screen.getByRole("region", { name: "Items inside" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload sharing" })).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
  apply.mockRejectedValueOnce("odd");
  match();
  await screen.findByText("Couldn't save sharing");
  expect(onSaved).not.toHaveBeenCalled();
  // A save that landed differently shows the reloaded access, never "saved".
  apply.mockRejectedValueOnce(
    new ScopedSharingIncompleteError(scoped({ folder: { ...folder, link: "viewer" } }), [
      `${BOB} (items inside)`,
    ]),
  );
  match();
  await screen.findByText(/Sharing wasn't saved as chosen for .* \(items inside\)/);
  expect(screen.getByText("Sharing not saved as chosen")).toBeTruthy();
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(
    (
      within(screen.getByRole("region", { name: "This folder" })).getByLabelText(
        "General access for this folder",
      ) as HTMLSelectElement
    ).value,
  ).toBe("anyone");
  // An unconfirmed save clears the controls until access is reloaded.
  apply.mockRejectedValueOnce(new SharingRefreshError(new Error("offline")));
  match();
  await screen.findByText(/couldn't be reloaded to confirm it/);
  expect(screen.getByText("Sharing not confirmed")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Items inside" })).toBeNull();
  expect(onSaved).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await editor();
  apply.mockRejectedValueOnce(new SharingRefreshError(new Error("offline"), false));
  match();
  await screen.findByText("Sharing outcome unknown");
  loadScoped.mockRejectedValueOnce("odd");
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await screen.findByText("Couldn't load sharing");
});

it("never re-announces an earlier save after a later one fails", async () => {
  apply.mockImplementationOnce(saves);
  show();
  await editor();
  fireEvent.change(screen.getByLabelText(`Role for ${BOB} on items inside`), {
    target: { value: "editor" },
  });
  await screen.findByText("Sharing saved");
  apply.mockRejectedValueOnce(new SharingError("Owner rows are read-only"));
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await screen.findByText("Owner rows are read-only");
  expect(screen.queryByText("Sharing saved")).toBeNull();
});

it("says when a save had nothing to change, without refreshing the listing", async () => {
  apply.mockImplementationOnce(async (_s, snapshot) => ({ snapshot, changed: false }));
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make this folder match items inside" }));
  await screen.findByText("Sharing already up to date");
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Items inside" })).toBeTruthy();
});

it("keeps every edit disabled when the items inside belong to someone else", async () => {
  loadScoped.mockResolvedValue(scoped({ ownsContents: false }));
  show();
  await editor();
  expect(screen.getByText(/You don't own the items inside this folder/)).toBeTruthy();
  for (const button of screen.getAllByRole("button", { name: /^Make / }))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(
    (screen.getByLabelText(`Role for ${BOB} on items inside`) as HTMLSelectElement).disabled,
  ).toBe(true);
});

it("keeps the dialog open while a scoped save is in flight", async () => {
  let done: (value: { snapshot: ScopedSharingSnapshot; changed: boolean }) => void = () => {};
  apply.mockReturnValueOnce(new Promise((resolve) => (done = resolve)));
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await screen.findByText("Saving sharing…");
  const finish = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
  expect(finish.disabled).toBe(true);
  fireEvent.click(finish);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  done({ snapshot: scoped(), changed: true });
  await screen.findByText("Sharing saved");
  await waitFor(() => expect(finish.disabled).toBe(false));
  fireEvent.click(finish);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows only the latest load, and ignores a second save while saving", async () => {
  // The first load finishes after a second one started for another folder.
  let finish: (value: ScopedSharingSnapshot) => void = () => {};
  loadScoped.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  loadScoped.mockResolvedValueOnce(
    scoped({
      contents: { ...contents, people: [person(ALICE, "owner"), person(CAROL, "editor")] },
    }),
  );
  const props = { session, onSaved, onMatched: vi.fn(), onSavingChange: vi.fn() };
  const view = render(<ScopedSharing {...props} resource={FOLDER} />);
  await waitFor(() => expect(loadScoped).toHaveBeenCalledTimes(1));
  view.rerender(<ScopedSharing {...props} resource={`${FOLDER}inner/`} />);
  await screen.findByText(CAROL);
  finish(scoped());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText(CAROL)).toBeTruthy();
  expect(screen.queryByText(BOB)).toBeNull();
  // A load still running when the editor closes is dropped.
  let late: (value: ScopedSharingSnapshot) => void = () => {};
  loadScoped.mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
  view.rerender(<ScopedSharing {...props} resource={`${FOLDER}other/`} />);
  await screen.findByText("Loading sharing…");
  view.unmount();
  late(scoped());
  cleanup();
  show();
  await editor();
  let done: (value: { snapshot: ScopedSharingSnapshot; changed: boolean }) => void = () => {};
  apply.mockReturnValueOnce(new Promise((resolve) => (done = resolve)));
  const match = screen.getByRole("button", { name: "Make items inside match this folder" });
  fireEvent.click(match);
  await screen.findByText("Saving sharing…");
  fireEvent.click(match);
  // A change event still reaches a disabled select; the save guard ignores it.
  fireEvent.change(screen.getByLabelText(`Role for ${BOB} on items inside`), {
    target: { value: "editor" },
  });
  expect(apply).toHaveBeenCalledTimes(1);
  done({ snapshot: scoped(), changed: true });
  await screen.findByText("Sharing saved");
});
