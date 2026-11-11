// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom

import type { GrantSnapshot } from "@jeswr/pod-access/roles";
import { serialize } from "@jeswr/rdf-serialize";
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
  CONTENTS_DIFFER,
  loadSharing,
  SharingConflictError,
  SharingIncompleteError,
  SharingRefreshError,
  type SharingSession,
  type SharingSnapshot,
} from "../src/apps/drive/lib/sharing/adapter";
import type { SharingState } from "../src/apps/drive/lib/sharing/types";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  ACP,
  ALICE,
  document as accessDocument,
  authorization,
  BOB,
  FILE,
  PUBLIC,
  policy,
} from "./sharing-fixtures";

vi.mock("../src/apps/drive/lib/sharing/adapter", async (original) => ({
  ...(await original<typeof import("../src/apps/drive/lib/sharing/adapter")>()),
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
  // The SDK token is opaque; the mocked adapter never inspects it.
  const grants = { url: FILE, grants: [], version: "test" } as unknown as GrantSnapshot;
  return { resource: FILE, grants, state: next, canManage, contentsDiffer: false };
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

it("enables folder editing and warns about independent item sharing before saving", async () => {
  load.mockResolvedValue({ ...snapshot(), resource: "https://example.org/drive/Work/" });
  show({ item: { name: "Work", url: "https://example.org/drive/Work/" } });
  await ready();
  expect(screen.getByText(CONTENTS_DIFFER).getAttribute("role")).toBe("note");
  expect(CONTENTS_DIFFER).toContain("have their own sharing won't change");
  expect((screen.getByLabelText(`Role for ${BOB}`) as HTMLSelectElement).disabled).toBe(false);
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText(`Role for ${BOB}`), { target: { value: "editor" } });
  await screen.findByText("Sharing saved");
  expect(apply).toHaveBeenCalledWith(
    session,
    expect.objectContaining({ canManage: true }),
    expect.objectContaining({ people: expect.arrayContaining([{ webId: BOB, role: "editor" }]) }),
  );
});

it("shows a supplied read-only reason with editing disabled", async () => {
  const readOnly = "Sharing is unavailable for this item";
  load.mockResolvedValue({ ...snapshot(state, false), readOnly });
  show();
  await ready();
  expect(screen.getByText(readOnly).getAttribute("role")).toBe("status");
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(true);
});

it("notes when a folder's contents are shared differently from the folder", async () => {
  load.mockResolvedValue({
    ...snapshot(state, false),
    contentsDiffer: true,
  });
  show();
  await ready();
  expect(screen.getByText(CONTENTS_DIFFER).getAttribute("role")).toBe("note");
  expect(CONTENTS_DIFFER).toMatch(/own sharing won't change/);
});

it("shows the reloaded access, not a save, when the selection was only partly applied", async () => {
  const fresh = snapshot(state);
  apply.mockRejectedValueOnce(new SharingIncompleteError(fresh, [BOB]));
  show();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  await screen.findByText(
    `Sharing wasn't saved as chosen for ${BOB}. The current access is shown; review it and try again.`,
  );
  // Bob still has access in the reloaded state, so his row stays.
  expect(screen.getByLabelText(`Role for ${BOB}`)).toBeTruthy();
  expect(screen.queryByText("Sharing saved")).toBeNull();
  expect(screen.getByText("Sharing not saved as chosen")).toBeTruthy();
  expect(onSaved).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
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
  await screen.findByText(
    "Sharing changed since you opened it. The current access is shown; review it and try again.",
  );
  expect(screen.queryByLabelText(`Role for ${BOB}`)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(apply).toHaveBeenCalledOnce();
});

it("clears stale controls on an unreadable conflict and reloads only on request", async () => {
  apply.mockRejectedValueOnce(new SharingConflictError());
  show();
  await ready();
  fireEvent.change(screen.getByLabelText(`Role for ${BOB}`), { target: { value: "editor" } });
  await screen.findByText(/Sharing changed since you opened it. Reload to see the current access/);
  expect(screen.queryByRole("region", { name: "People with access" })).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
  load.mockResolvedValueOnce(
    snapshot({ ...state, people: state.people.filter((p) => p.webId !== BOB) }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
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

it("invalidates stale permissions after a committed save and retries only the refresh", async () => {
  apply.mockRejectedValueOnce(new SharingRefreshError(new Error("Refresh returned 503")));
  show();
  await ready();
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await screen.findByText(/sharing change was sent, but current access couldn't be reloaded/);
  expect(screen.queryByRole("region", { name: "General access" })).toBeNull();
  expect(screen.queryByRole("region", { name: "People with access" })).toBeNull();
  // Unverified access is never announced as saved.
  expect(screen.queryByText("Sharing saved")).toBeNull();
  expect(screen.getByText("Sharing not confirmed")).toBeTruthy();
  expect(onSaved).toHaveBeenCalledOnce();
  load.mockRejectedValueOnce(new Error("Still unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Still unavailable");
  expect(screen.queryByLabelText("Who can access")).toBeNull();
  expect(screen.getByText("Sharing not confirmed")).toBeTruthy();
  load.mockResolvedValueOnce(snapshot({ ...state, link: "viewer", public: "viewer" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).value).toBe("anyone");
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(false);
  expect(apply).toHaveBeenCalledOnce();
});

it("clears stale controls for a lost PUT response and retries access without claiming the save succeeded", async () => {
  apply.mockRejectedValueOnce(new SharingRefreshError(new TypeError("Failed to fetch"), false));
  show();
  await ready();
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await screen.findByText(/sharing write outcome is unknown/);
  expect(screen.queryByLabelText("Who can access")).toBeNull();
  expect(screen.queryByRole("region", { name: "People with access" })).toBeNull();
  expect(screen.queryByText("Sharing saved")).toBeNull();
  expect(screen.getByText("Sharing outcome unknown")).toBeTruthy();
  expect(onSaved).toHaveBeenCalledOnce();
  load.mockResolvedValueOnce(snapshot({ ...state, link: "viewer", public: "viewer" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).value).toBe("anyone");
  expect(apply).toHaveBeenCalledOnce();
});

it.each(
  (["wac", "acp"] as const).flatMap((model) =>
    [false, true].map((wasPublic) => ({ model, wasPublic })),
  ),
)("rechecks the real $model policy after a committed PUT loses its response (was public: $wasPublic)", async ({
  model,
  wasPublic,
}) => {
  const actual = await vi.importActual<typeof import("../src/apps/drive/lib/sharing/adapter")>(
    "../src/apps/drive/lib/sharing/adapter",
  );
  const pod = createDemoPod({ root: session.storageUrl });
  await pod.fetch(FILE, { method: "PUT", body: "report" });
  const doc = accessDocument(model);
  if (model === "wac") {
    authorization(doc, ALICE, ["Read", "Write", "Control"]);
    if (wasPublic) authorization(doc, PUBLIC, ["Read"]);
  } else {
    // CSS ACP managers hold resource Control (the SDK's default dialect).
    policy(doc, ALICE, ["Read", "Write", "Control"]);
    if (wasPublic) policy(doc, PUBLIC, ["Read"]);
  }
  await pod.fetch(doc.source, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serialize([...doc.dataset]),
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const response = await pod.fetch(url, init);
    if (init?.method === "PUT") throw new TypeError("Failed to fetch");
    if (model === "wac" || String(url).endsWith(".acr")) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${String(url)}.acr>; rel="${ACP}accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  });
  load.mockImplementation(actual.loadSharing);
  apply.mockImplementation(actual.applySharing);
  show({ session: { ...session, fetch } });
  await ready();
  fireEvent.change(screen.getByLabelText("Who can access"), {
    target: { value: wasPublic ? "restricted" : "anyone" },
  });
  await screen.findByText(/sharing write outcome is unknown/);
  expect(screen.queryByLabelText("Who can access")).toBeNull();
  expect(screen.queryByText("Sharing saved")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).value).toBe(
    wasPublic ? "restricted" : "anyone",
  );
  expect(screen.queryByText("Sharing outcome unknown")).toBeNull();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

it.each([
  "Done",
  "Close",
  "Escape",
  "outside",
])("keeps a pending public revocation visible after %s dismissal and reports PUT failure", async (dismissal) => {
  load.mockResolvedValue(snapshot({ ...state, link: "viewer", public: "viewer" }));
  let reject!: (reason: unknown) => void;
  apply.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  show();
  await ready();
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "restricted" } });
  await screen.findByText("Saving sharing…");
  if (dismissal === "Escape") fireEvent.keyDown(document, { key: "Escape" });
  else if (dismissal === "outside") {
    fireEvent(document.body, new MouseEvent("pointerdown", { bubbles: true }));
    fireEvent.click(document.body);
  } else fireEvent.click(screen.getByRole("button", { name: dismissal }));
  expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error("Couldn't save sharing (500)")));
  await screen.findByText("Couldn't save sharing (500)");
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).value).toBe("anyone");
  expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps an Editor removal open on Escape until a rejected PUT is reported", async () => {
  load.mockResolvedValue(
    snapshot({
      ...state,
      people: state.people.map((p) => (p.webId === BOB ? { ...p, role: "editor" } : p)),
    }),
  );
  let reject!: (reason: unknown) => void;
  apply.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  show();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: `Remove access for ${BOB}` }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Couldn't save sharing (403)")));
  await screen.findByText("Couldn't save sharing (403)");
  expect((screen.getByLabelText(`Role for ${BOB}`) as HTMLSelectElement).value).toBe("editor");
});

it("returns focus stranded by a save to the control, or to Done when the control is gone", async () => {
  show();
  await ready();
  const done = screen.getByRole("button", { name: "Done" });
  // A removal deletes its own trigger, so focus moves to Done.
  const remove = screen.getByRole("button", { name: `Remove access for ${BOB}` });
  remove.focus();
  fireEvent.click(remove);
  await waitFor(() => expect(document.activeElement).toBe(done));
  // A control that survives the save gets its focus back.
  const general = screen.getByLabelText("Who can access");
  general.focus();
  const focusGeneral = vi.spyOn(general, "focus");
  fireEvent.change(general, { target: { value: "anyone" } });
  // While saving, the disabled control loses focus to the body (see the Share case below).
  const stranded = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  await screen.findByLabelText("Link role");
  await waitFor(() => expect(focusGeneral).toHaveBeenCalled());
  stranded.mockRestore();
  expect(document.activeElement).toBe(general);
  // Focus the user moved elsewhere during the save stays where they put it.
  const linkRole = screen.getByLabelText("Link role");
  linkRole.focus();
  fireEvent.change(linkRole, { target: { value: "editor" } });
  const copy = screen.getByRole("button", { name: "Copy link" });
  copy.focus();
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(3));
  await waitFor(() => expect((linkRole as HTMLSelectElement).disabled).toBe(false));
  expect(document.activeElement).toBe(copy);
  // A successful add leaves Share disabled, so focus moves to Done.
  fireEvent.change(screen.getByRole("combobox", { name: "Add people" }), {
    target: { value: "https://example.org/carol#me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add person" }));
  const share = screen.getByRole("button", { name: "Share" });
  share.focus();
  // Chrome drops focus to the body when a focused control becomes disabled, without a
  // focusout the modal's focus scope could react to; jsdom keeps it, so report the body.
  const focusDone = vi.spyOn(done, "focus");
  fireEvent.click(share);
  const active = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  await screen.findByLabelText("Role for https://example.org/carol#me");
  await waitFor(() => expect(focusDone).toHaveBeenCalled());
  active.mockRestore();
  expect(share).toHaveProperty("disabled", true);
});
