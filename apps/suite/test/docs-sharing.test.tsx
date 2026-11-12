// AUTHORED-BY Codex GPT-6.1
// @vitest-environment jsdom
import { type GrantSnapshot, readGrants } from "@jeswr/pod-access/roles";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { EditorMenubar } from "../src/apps/docs/components/editor-menubar";
import { useDocumentSharing } from "../src/apps/docs/hooks/use-document-sharing";
import {
  applyDocumentSharing as applySharing,
  loadDocumentSharing as loadSharing,
} from "../src/apps/docs/lib/sharing/document-sharing";
import {
  loadError,
  type SharingSession,
  type SharingSnapshot,
} from "../src/apps/drive/lib/sharing/adapter";

vi.mock("../src/apps/docs/lib/sharing/document-sharing", async (original) => ({
  ...(await original<typeof import("../src/apps/docs/lib/sharing/document-sharing")>()),
  loadDocumentSharing: vi.fn(),
  applyDocumentSharing: vi.fn(),
}));
const resource = "https://example.org/docs/plan.ttl";
const session: SharingSession = {
  fetch,
  webId: "https://example.org/profile#me",
  storageUrl: "https://example.org/",
};
function snapshot(
  overrides: Partial<SharingSnapshot> = {},
): Awaited<ReturnType<typeof loadSharing>> {
  return {
    resource,
    companions: [],
    pins: new Map<string, string>(),
    grants: { url: resource, grants: [], version: "test" } as unknown as GrantSnapshot,
    canManage: true,
    contentsDiffer: false,
    state: {
      people: [],
      link: "none",
      public: "none",
      general: { inherited: false, explicit: false, sources: [] },
    },
    ...overrides,
  };
}
type Options = {
  resource?: string | undefined;
  online?: boolean;
  title?: string;
  session?: SharingSession;
  readOnly?: boolean;
};
let sharing: ReturnType<typeof useDocumentSharing>;
const noop = () => {};
function Harness({
  resource: url = resource,
  online = true,
  title = "Plan",
  session: account = session,
  readOnly = false,
}: Options) {
  sharing = useDocumentSharing(account, url === "draft" ? undefined : url, title, online, readOnly);
  return (
    <>
      {sharing.button}
      <EditorMenubar
        editor={{} as Editor}
        actions={[]}
        mac={false}
        online={online}
        readOnly={readOnly}
        draft={url === "draft"}
        outline={false}
        setOutline={noop}
        zoom={100}
        setZoom={noop}
        rename={noop}
        copy={noop}
        remove={noop}
        importFile={noop}
        print={noop}
        download={noop}
        help={noop}
        share={sharing.open}
        shareDisabledReason={sharing.disabledReason}
      />
      {sharing.dialog}
    </>
  );
}
const header = () => screen.getByRole("button", { name: "Share" }) as HTMLButtonElement;
async function menu() {
  const file = screen.getByRole("menuitem", { name: "File" });
  await act(() => file.focus());
  fireEvent.keyDown(file, { key: "ArrowDown" });
  return screen.findByRole("menuitem", { name: "Share…" });
}
async function enabled() {
  await waitFor(() => expect(header().getAttribute("aria-disabled")).toBe("false"));
}
async function permissionError(status: number | "scope" | "unsupported") {
  try {
    await readGrants(resource, {
      root: status === "scope" ? "https://someone-else.example/" : session.storageUrl,
      fetch: async (_input, init) =>
        new Response(null, {
          status:
            init?.method === "HEAD" && status !== 404
              ? 200
              : typeof status === "number"
                ? status
                : 200,
          headers: status === "unsupported" ? {} : { Link: `<${resource}.acl>; rel="acl"` },
        }),
    });
  } catch (error) {
    return loadError(error);
  }
  throw new Error("Expected the SDK permission read to fail");
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSharing).mockResolvedValue(snapshot());
  vi.mocked(applySharing).mockResolvedValue(snapshot());
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the same Drive dialog from the header and File menu for the main resource", async () => {
  render(<Harness />);
  expect(sharing.disabledReason).toBe("Checking sharing permissions…");
  await enabled();
  await act(() => header().focus());
  fireEvent.click(header());
  const dialog = await screen.findByRole("dialog", { name: "Share “Plan”" });
  expect(dialog.querySelector('[role="note"]')).toBeNull();
  await screen.findByLabelText("Who can access");
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await waitFor(() => expect(applySharing).toHaveBeenCalledOnce());
  expect(applySharing).toHaveBeenCalledWith(
    session,
    expect.objectContaining({ resource }),
    expect.anything(),
  );
  await screen.findByText("Sharing saved");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(header()));
  const item = await menu();
  await act(() => item.focus());
  fireEvent.keyDown(item, { key: "Enter" });
  await screen.findByRole("dialog", { name: "Share “Plan”" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(vi.mocked(loadSharing).mock.calls.every(([, url]) => url === resource)).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "File" })),
  );
});

it.each([
  [{ resource: "draft" }, "Save this document to your pod before sharing."],
  [{ online: false }, "Reconnect to manage sharing."],
  [{ readOnly: true }, "Read-only documents cannot be shared."],
] as const)("disables both entry points with an explanation: %s", async (options, reason) => {
  render(<Harness {...options} />);
  expect(header().getAttribute("aria-disabled")).toBe("true");
  expect(sharing.disabledReason).toBe(reason);
  act(() => sharing.open());
  expect(screen.queryByRole("dialog")).toBeNull();
  const wrapper = header().parentElement as HTMLElement;
  fireEvent.focus(wrapper);
  await screen.findByRole("tooltip");
  expect(screen.getByRole("tooltip").textContent).toBe(reason);
  fireEvent.blur(wrapper);
  const item = await menu();
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.title).toBe(reason);
  expect(screen.getByRole("menuitem", { name: "Share…", description: reason })).toBe(item);
  expect(loadSharing).not.toHaveBeenCalled();
});

it.each([
  undefined,
  "This resource is read-only.",
])("uses the adapter's permission decision and explanation (%s)", async (reason) => {
  vi.mocked(loadSharing).mockResolvedValue(
    snapshot({ canManage: false, ...(reason ? { readOnly: reason } : {}) }),
  );
  render(<Harness />);
  await waitFor(() =>
    expect(sharing.disabledReason).toBe(reason ?? "Only the owner can change sharing."),
  );
  expect(header().getAttribute("aria-disabled")).toBe("true");
  const item = await menu();
  expect(item.getAttribute("aria-disabled")).toBe("true");
});

it.each([
  401,
  403,
  "scope",
] as const)("disables both entry points for an SDK refusal (%s)", async (status) => {
  vi.mocked(loadSharing).mockRejectedValue(await permissionError(status));
  render(<Harness />);
  await waitFor(() => expect(sharing.disabledReason).toBe("Only the owner can change sharing."));
  expect(header().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(header());
  act(() => sharing.open());
  expect(screen.queryByRole("dialog")).toBeNull();
  const item = await menu();
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(
    screen.getByRole("menuitem", {
      name: "Share…",
      description: "Only the owner can change sharing.",
    }),
  ).toBe(item);
});

it.each([
  500,
  503,
  "network",
] as const)("allows the dialog to retry a transient permission failure (%s)", async (status) => {
  const error =
    status === "network"
      ? loadError(new TypeError("Failed to fetch"))
      : await permissionError(status);
  vi.mocked(loadSharing).mockRejectedValue(error);
  render(<Harness title="" />);
  await enabled();
  // A detached invoking element must not break close-focus restoration.
  vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
  act(() => sharing.open());
  await screen.findByRole("dialog", { name: "Share “Untitled document”" });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn't load sharing. Try again.",
  );
  vi.mocked(loadSharing).mockResolvedValue(snapshot());
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Who can access");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it.each([
  404,
  "unsupported",
  "unknown",
] as const)("keeps non-transient permission failures disabled (%s)", async (status) => {
  vi.mocked(loadSharing).mockRejectedValue(
    status === "unknown" ? "unknown" : await permissionError(status),
  );
  render(<Harness />);
  await waitFor(() =>
    expect(sharing.disabledReason).toBe("Sharing is unavailable for this document."),
  );
  expect(header().getAttribute("aria-disabled")).toBe("true");
});

it("keeps the focused Share button mounted across permission and connectivity changes", async () => {
  const warn = vi.spyOn(console, "warn");
  let finish!: (value: ReturnType<typeof snapshot>) => void;
  vi.mocked(loadSharing).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Harness />);
  const button = header();
  const wrapper = button.parentElement;
  await act(() => button.focus());
  await act(() => finish(snapshot()));
  await enabled();
  expect(header()).toBe(button);
  expect(button.parentElement).toBe(wrapper);
  expect(document.activeElement).toBe(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  view.rerender(<Harness online={false} />);
  expect(header()).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await screen.findByRole("tooltip");
  view.rerender(<Harness />);
  await enabled();
  expect(header()).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  "saved",
  "failed",
])("shows an in-flight sharing outcome after going offline (%s)", async (outcome) => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  let reject!: (reason: Error) => void;
  vi.mocked(applySharing).mockImplementationOnce(
    () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const view = render(<Harness />);
  await enabled();
  const button = header();
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog");
  await screen.findByLabelText("Who can access");
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await screen.findByText("Saving sharing…");
  view.rerender(<Harness online={false} />);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(dialog.textContent).toContain("Reconnect to manage sharing.");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  if (outcome === "saved") await act(() => resolve(snapshot()));
  else await act(() => reject(new Error("Sharing write failed")));
  await screen.findByText(outcome === "saved" ? "Sharing saved" : "Sharing write failed");
  expect((screen.getByLabelText("Who can access") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  expect(applySharing).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("discards stale permission reads across resource/account changes and closes on draft transitions", async () => {
  let finish!: (value: ReturnType<typeof snapshot>) => void;
  vi.mocked(loadSharing).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Harness />);
  const other = "https://example.org/docs/other.ttl";
  view.rerender(<Harness resource={other} />);
  await enabled();
  await act(() => finish(snapshot({ canManage: false })));
  expect(header().getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(header());
  await screen.findByRole("dialog");
  view.rerender(<Harness resource={other} online={false} />);
  expect(screen.queryByRole("dialog")).not.toBeNull();
  view.rerender(<Harness resource={other} session={{ ...session }} />);
  await enabled();
  fireEvent.click(header());
  await screen.findByRole("dialog");
  view.rerender(<Harness resource="draft" />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

// Repair uses the entry point's current selection, even when no role was changed.
it("shows legacy differences and saves them through the document plan", async () => {
  vi.mocked(loadSharing).mockResolvedValue(
    snapshot({
      notice: "Some parts of this document are shared differently. Saving will make them match.",
      needsSave: true,
    }),
  );
  render(<Harness />);
  await enabled();
  fireEvent.click(header());
  await screen.findByText(
    "Some parts of this document are shared differently. Saving will make them match.",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  await screen.findByText("Sharing saved");
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  expect(applySharing).toHaveBeenCalledWith(session, expect.anything(), snapshot().state);
});

it("offers Retry for an incomplete document plan, then shows the legacy repair action", async () => {
  const { SharingRefreshError } = await import("../src/apps/drive/lib/sharing/adapter");
  const error = new SharingRefreshError(new Error("second target"), false);
  error.message =
    "Document sharing is incomplete. Companion matches; document not confirmed. Retry.";
  vi.mocked(applySharing).mockRejectedValueOnce(error);
  render(<Harness />);
  await enabled();
  fireEvent.click(header());
  await screen.findByLabelText("Who can access");
  fireEvent.change(screen.getByLabelText("Who can access"), { target: { value: "anyone" } });
  await screen.findByText(error.message);
  expect(screen.queryByText("Sharing saved")).toBeNull();
  vi.mocked(loadSharing).mockResolvedValue(
    snapshot({
      notice: "Some parts of this document are shared differently. Saving will make them match.",
      needsSave: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Save$/ }));
  await screen.findByText("Sharing saved");
});
