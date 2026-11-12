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
import { scopesMatch } from "../src/apps/drive/components/share-scoped";
import {
  applyScopedSharing,
  loadScopedSharing,
  loadSharing,
  type ScopedSharingSnapshot,
  SharingConflictError,
  type SharingSession,
  type SharingSnapshot,
} from "../src/apps/drive/lib/sharing/adapter";
import { SharingError } from "../src/apps/drive/lib/sharing/rdf";
import type { SharingState } from "../src/apps/drive/lib/sharing/types";
import { ALICE, BOB } from "./sharing-fixtures";

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
  return { resource: FOLDER, grants, folder, contents, canManage: true, ...next };
}
// Hoisted for the adapter mock: the SDK brands its partial-scope errors.
const { partial } = vi.hoisted(() => ({ partial: new Error("different sharing") }));
const session: SharingSession = { fetch, webId: ALICE, storageUrl: "https://example.org/" };
const onSaved = vi.fn();
function show(disabledReason?: string) {
  return render(
    <ShareDialog
      item={{ name: "drop", url: FOLDER }}
      session={session}
      link="/drive/p/drop"
      onClose={vi.fn()}
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

it("opens the scope-aware editor for a folder shared differently inside, and changes each scope", async () => {
  apply.mockImplementation(async (_s, _snapshot, selection) => selected(selection));
  show();
  await editor();
  expect(screen.getByRole("note").textContent).toContain("shared differently");
  const inside = within(screen.getByRole("region", { name: "Items inside" }));
  const own = within(screen.getByRole("region", { name: "This folder" }));
  expect(inside.getByText(`${ALICE} (you)`)).toBeTruthy();
  expect(
    (inside.getByLabelText(`Role for ${ALICE} on items inside`) as HTMLSelectElement).disabled,
  ).toBe(true);
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
  fireEvent.change(own.getByLabelText("General access for this folder"), {
    target: { value: "viewer" },
  });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1]?.[2].folder).toMatchObject({ link: "viewer", public: "viewer" });
  fireEvent.change(
    within(screen.getByRole("region", { name: "Items inside" })).getByLabelText(
      "General access for items inside",
    ),
    { target: { value: "none" } },
  );
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
  expect(apply.mock.calls[2]?.[2].contents).toMatchObject({ link: "none", public: "none" });
  fireEvent.click(
    within(screen.getByRole("region", { name: "Items inside" })).getByRole("button", {
      name: `Remove access for ${BOB} on items inside`,
    }),
  );
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(4));
  expect(apply.mock.calls[3]?.[2].contents.people).toEqual([person(ALICE, "owner")]);
});

it("makes the scopes match either way, then hands back to the ordinary dialog", async () => {
  apply.mockImplementation(async (_s, _snapshot, selection) => selected(selection));
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make this folder match items inside" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]?.[2]).toEqual({ folder: contents, contents });
  // Matching scopes reload the ordinary dialog.
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  load.mockResolvedValue({
    resource: FOLDER,
    grants: { url: FOLDER, grants: [], version: "t" },
    state: folder,
    canManage: true,
    contentsDiffer: false,
  } as unknown as SharingSnapshot);
  cleanup();
  load.mockRejectedValueOnce(partial);
  show();
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1]?.[2]).toEqual({ folder, contents: folder });
  await screen.findByRole("region", { name: "People with access" });
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
  apply.mockRejectedValueOnce(new SharingConflictError());
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await screen.findByText(/Sharing changed since you opened it/);
  // A stale save changed nothing, so the listing isn't refreshed.
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await editor();
  apply.mockRejectedValueOnce(new SharingError("Sharing wasn't saved as chosen."));
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await screen.findByText("Sharing wasn't saved as chosen.");
  expect(onSaved).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await editor();
  apply.mockRejectedValueOnce("odd");
  fireEvent.click(screen.getByRole("button", { name: "Make items inside match this folder" }));
  await screen.findByText("Couldn't save sharing");
  loadScoped.mockRejectedValueOnce("odd");
  fireEvent.click(screen.getByRole("button", { name: "Reload sharing" }));
  await screen.findByText("Couldn't load sharing");
});

it("ignores a load that finishes after the dialog closed, and a second save while saving", async () => {
  let finish: (value: ScopedSharingSnapshot) => void = () => {};
  loadScoped.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const first = show();
  await waitFor(() => expect(loadScoped).toHaveBeenCalledTimes(1));
  first.unmount();
  finish(scoped());
  loadScoped.mockRejectedValueOnce(new Error("late"));
  const second = show();
  await waitFor(() => expect(loadScoped).toHaveBeenCalledTimes(2));
  second.unmount();
  show();
  await editor();
  let done: (value: ScopedSharingSnapshot) => void = () => {};
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
  done(scoped());
  await screen.findByText("Sharing saved");
});
