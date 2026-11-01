// AUTHORED-BY Codex
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Reuse the workspace's installed UI test tooling; this app adds no dependencies.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import userEvent from "../../../packages/suite-ui/node_modules/@testing-library/user-event";
import { ShareDialog } from "../src/apps/drive/components/share-dialog";
import {
  applySharing,
  loadSharing,
  SharingConflictError,
  type SharingSession,
  type SharingSnapshot,
} from "../src/apps/drive/lib/sharing/apply";
import type { SharingState } from "../src/apps/drive/lib/sharing/types";
import { ALICE, document as accessDocument, BOB, FILE } from "./sharing-fixtures";

vi.mock("../src/apps/drive/lib/sharing/apply", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/sharing/apply")>()),
  loadSharing: vi.fn(),
  applySharing: vi.fn(),
}));
const load = vi.mocked(loadSharing);
const apply = vi.mocked(applySharing);
const state: SharingState = {
  people: [
    { webId: ALICE, role: "owner", inherited: false, explicit: true, sources: [`${FILE}.acl`] },
    { webId: BOB, role: "viewer", inherited: false, explicit: true, sources: [`${FILE}.acl`] },
  ],
  link: "none",
  public: "none",
  general: { inherited: false, explicit: false, sources: [] },
};
function snapshot(next = state, canManage = true): SharingSnapshot {
  const own = accessDocument();
  return {
    input: { access: { resource: FILE, documents: [own] } },
    own,
    state: next,
    canManage,
    etags: new Map(),
  };
}
const session: SharingSession = { fetch, webId: ALICE, storageUrl: "https://example.org/" };
const onClose = vi.fn();
const onSaved = vi.fn();
function show(options: Partial<React.ComponentProps<typeof ShareDialog>> = {}) {
  return render(
    <ShareDialog
      item={{ name: "report.txt", url: FILE }}
      session={session}
      link="/drive/p/shared-file"
      onClose={onClose}
      onSaved={onSaved}
      {...options}
    />,
  );
}
async function ready() {
  await screen.findByRole("region", { name: "People with access" });
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(snapshot());
  apply.mockImplementation(async (_session, _snapshot, selection) =>
    snapshot({
      ...state,
      ...selection,
      people: selection.people.map((p) => ({
        ...p,
        inherited: false,
        explicit: true,
        sources: [],
      })),
    }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

it("loads an accessible dialog, locks owner controls, and closes with Done and Escape", async () => {
  show({ onCloseAutoFocus: vi.fn() });
  await ready();
  expect(screen.getByRole("dialog", { name: "Share “report.txt”" })).toBeTruthy();
  expect((screen.getByLabelText(`Role for ${ALICE}`) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText(/cannot remove your own Control/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: `Remove access for ${ALICE}` }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onClose).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
});

it("adds a validated WebID as Editor and saves without duplicating existing people", async () => {
  show();
  await ready();
  const input = screen.getByRole("combobox", { name: "Add people" });
  fireEvent.change(input, { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Add person" }));
  expect(screen.getByRole("alert").textContent).toContain("account ID");
  fireEvent.change(input, { target: { value: "https://example.org/carol#me" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Role for added people"), { target: { value: "editor" } });
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await screen.findByLabelText("Role for https://example.org/carol#me");
  expect(apply).toHaveBeenLastCalledWith(
    session,
    expect.anything(),
    expect.objectContaining({
      people: expect.arrayContaining([{ webId: "https://example.org/carol#me", role: "editor" }]),
    }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: BOB } });
  fireEvent.click(screen.getByRole("button", { name: "Add person" }));
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply.mock.calls[1]?.[2].people.filter((p) => p.webId === BOB)).toHaveLength(1);
});

it("changes a person's role, removes access, changes public link roles, and restricts both anonymous fields", async () => {
  show();
  await ready();
  fireEvent.change(screen.getByLabelText(`Role for ${BOB}`), { target: { value: "editor" } });
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  await waitFor(() => expect(screen.queryByLabelText(`Role for ${BOB}`)).toBeNull());
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await screen.findByLabelText("Link role");
  expect(screen.getByText(/without signing in/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Link role"), { target: { value: "editor" } });
  await waitFor(() =>
    expect((screen.getByLabelText("Link role") as HTMLSelectElement).value).toBe("editor"),
  );
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "restricted" } });
  await waitFor(() => expect(screen.queryByLabelText("Link role")).toBeNull());
  expect(apply).toHaveBeenLastCalledWith(
    session,
    expect.anything(),
    expect.objectContaining({ link: "none", public: "none" }),
  );
});

it("explains inherited people and general access and prevents direct changes", async () => {
  load.mockResolvedValue(
    snapshot({
      ...state,
      people: state.people.map((p) => ({ ...p, inherited: true })),
      link: "viewer",
      public: "viewer",
      general: { inherited: true, explicit: false, sources: ["https://example.org/drive/.acl"] },
    }),
  );
  show();
  await ready();
  expect(screen.getAllByText(/Inherited from/)).toHaveLength(3);
  expect((screen.getByLabelText(`Role for ${BOB}`) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Link role") as HTMLSelectElement).disabled).toBe(true);
});

it("shows read-only and empty states, while still allowing Copy link", async () => {
  load.mockResolvedValue(snapshot({ ...state, people: [] }, false));
  show();
  await ready();
  expect(screen.getByText("No people have access.")).toBeTruthy();
  expect(screen.getByText(/Only an owner with Control/)).toBeTruthy();
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Share" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Link copied");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/drive/p/shared-file`,
  );
});

it("shows load failures, retries, and reports clipboard errors", async () => {
  load.mockRejectedValueOnce(new Error("Cannot read ACL"));
  show();
  await screen.findByText("Cannot read ACL");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("blocked"));
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Couldn't copy the link. Try again.");
});

it("reloads and displays the exact conflict message without retrying a save", async () => {
  apply.mockRejectedValueOnce(
    new SharingConflictError(
      snapshot({ ...state, people: state.people.filter((p) => p.webId !== BOB) }),
    ),
  );
  show();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  await screen.findByText("Sharing changed elsewhere, review and try again");
  expect(screen.queryByLabelText(`Role for ${BOB}`)).toBeNull();
  expect(apply).toHaveBeenCalledOnce();
});

it.each([
  new Error("Write denied"),
  "failure",
])("keeps the current policy after save errors (%s)", async (reason) => {
  apply.mockRejectedValueOnce(reason);
  show();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  await screen.findByText(reason instanceof Error ? reason.message : "Couldn't save sharing");
  expect(screen.getByLabelText(`Role for ${BOB}`)).toBeTruthy();
});

it("disables edits while saving and ignores repeated save events", async () => {
  let resolve!: (value: SharingSnapshot) => void;
  apply.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  show();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  await screen.findByText("Saving sharing…");
  expect((screen.getByLabelText(`Role for ${BOB}`) as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(`Role for ${BOB}`), { target: { value: "editor" } });
  expect(apply).toHaveBeenCalledOnce();
  await act(async () => resolve(snapshot()));
});

it("ignores superseded load results and errors after unmount", async () => {
  let resolve!: (value: SharingSnapshot) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = show();
  expect(screen.getByText("Loading sharing…")).toBeTruthy();
  view.unmount();
  await act(async () => resolve(snapshot()));
  let reject!: (reason: unknown) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  const second = show();
  second.unmount();
  await act(async () => reject("failure"));
});

it("uses a readable fallback for an unknown load error", async () => {
  load.mockRejectedValueOnce("failure");
  show();
  await screen.findByText("Couldn't load sharing");
});

it("traps keyboard focus within the modal", async () => {
  const user = userEvent.setup();
  show();
  await ready();
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  screen.getByRole("button", { name: "Close" }).focus();
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
});
