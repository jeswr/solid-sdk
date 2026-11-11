// AUTHORED-BY Codex GPT-6
// Radix reads DOM availability at import time.
import "./drive-ui-dom";
import { createRequire } from "node:module";
import { createShareInbox, type ShareBatch, type ShareIntakePlugin } from "@jeswr/suite-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShareBatchView, ShareScreen } from "../src/apps/drive/components/share-screen";
import type { UploadQueue, UploadTask } from "../src/apps/drive/state/uploads";
import type { PodSession } from "../src/lib/session/types";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { createShareIntake } from "../src/shell/share/intake";
import { act, deferred, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
afterEach(cleanup);
const session = vi.hoisted(() => ({
  status: "signed-out",
  session: undefined as PodSession | undefined,
}));
const drive = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({ saveLink: vi.fn(), saveText: vi.fn() }));
beforeEach(() => {
  session.status = "signed-out";
  session.session = undefined;
  vi.clearAllMocks();
});
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  usePodSessionState: () => session,
}));
vi.mock("../src/apps/drive/state/drive-context", () => ({
  DriveProvider: ({ children }: { children: React.ReactNode }) => children,
  useDrive: drive,
  useFolder: () => ({ status: "ready", items: [] }),
}));
vi.mock("../src/apps/drive/state/share-actions", () => ({ createShareActions: () => actions }));
const file: ShareBatch["items"][number] = {
  kind: "file",
  name: "report.txt",
  mimeType: "text/plain",
  size: 5,
};
const link: ShareBatch["items"][number] = {
  kind: "url",
  title: "<img src=x onerror=alert(1)>",
  url: "https://example.org/article",
};
const text: ShareBatch["items"][number] = {
  kind: "text",
  text: "<script>hello</script>\nSecond line",
};

async function fixture(items: ShareBatch["items"] = [file]) {
  const batch: ShareBatch = { id: "test-batch", receivedAt: "2026-11-10T12:00:00Z", items };
  const plugin: ShareIntakePlugin = {
    getPending: vi.fn(async () => ({ batches: [batch] })),
    acknowledge: vi.fn(async () => {}),
    readChunk: vi.fn(async () => ({ data: btoa("hello"), eof: true })),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  };
  const intake = createShareIntake(async () => createShareInbox(plugin));
  await intake.refresh();
  const tasks: UploadTask[] = [];
  let changed: ((task: UploadTask) => void) | undefined;
  const uploads: UploadQueue = {
    tasks,
    enqueue: vi.fn((folder, files, options) => {
      const source = [...files][0] as File;
      const task: UploadTask = {
        id: "upload-1",
        name: source.name,
        size: source.size,
        folder,
        status: "uploading",
      };
      tasks.push(task);
      changed = options?.onChange;
      options?.onChange?.(task);
    }),
    resolve: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
  };
  const saveLink = vi.fn(async () => {});
  const saveText = vi.fn(async () => {});
  const view = () =>
    render(
      h(ShareBatchView, {
        intake,
        batch,
        uploads,
        folder: "https://pod.example/drive/chosen/",
        saveLink,
        saveText,
      }),
    );
  const update = (status: UploadTask["status"], extra: Partial<UploadTask> = {}) =>
    act(() => {
      changed?.({ ...(tasks[0] as UploadTask), status, ...extra });
    });
  return { batch, plugin, intake, uploads, saveLink, saveText, view, update };
}

it("reads a native file into a Blob and uses the chosen folder and upload queue; acknowledges only after success", async () => {
  const test = await fixture();
  test.view();
  expect(screen.getByText("report.txt")).toBeTruthy();
  expect(screen.getByText("text/plain · 5 bytes")).toBeTruthy();
  expect(test.plugin.readChunk).not.toHaveBeenCalled();
  expect(test.uploads.enqueue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalledTimes(1));
  const [folder, files] = vi.mocked(test.uploads.enqueue).mock.calls[0] as [string, File[]];
  expect(folder).toBe("https://pod.example/drive/chosen/");
  expect(await files[0]?.text()).toBe("hello");
  expect(test.plugin.readChunk).toHaveBeenCalledWith({
    batchId: test.batch.id,
    index: 0,
    offset: 0,
    length: 5,
  });
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Discard batch" }).hasAttribute("disabled")).toBe(true);
  await test.update("done");
  await waitFor(() =>
    expect(test.plugin.acknowledge).toHaveBeenCalledWith({ batchId: test.batch.id }),
  );
  expect(test.intake.getSnapshot().batches).toEqual([]);
});

it("keeps failed uploads pending and retries the same queue job", async () => {
  const test = await fixture();
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalled());
  await test.update("failed");
  expect(screen.getByRole("alert").textContent).toContain("still pending");
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry Save to Drive" }));
  expect(test.uploads.retry).toHaveBeenCalledWith("upload-1");
  await test.update("done");
  await waitFor(() => expect(test.plugin.acknowledge).toHaveBeenCalledTimes(1));
});

it("retains malformed or unreadable file bytes and allows a fresh read on retry", async () => {
  const test = await fixture();
  vi.mocked(test.plugin.readChunk).mockResolvedValueOnce({ data: btoa("bad"), eof: true });
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await screen.findByRole("alert");
  expect(test.uploads.enqueue).not.toHaveBeenCalled();
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalledTimes(1));
});

it("re-reads a failed item into the current queue after a route or account session replaces its queue", async () => {
  const test = await fixture();
  const view = test.view();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalledTimes(1));
  await test.update("failed");
  view.unmount();
  (test.uploads.tasks as UploadTask[]).length = 0;
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Retry Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalledTimes(2));
  expect(test.plugin.readChunk).toHaveBeenCalledTimes(2);
  expect(test.uploads.retry).not.toHaveBeenCalled();
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
});

it("renders link and text as plain text and waits for every item before acknowledging", async () => {
  const test = await fixture([link, text]);
  const pending = deferred<void>();
  test.saveText.mockImplementation(() => pending.promise);
  const view = test.view();
  expect(view.container.querySelector("img, script")).toBeNull();
  expect(screen.getByText(link.kind === "url" ? (link.title as string) : "")).toBeTruthy();
  expect(test.saveLink).not.toHaveBeenCalled();
  expect(test.saveText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await waitFor(() => expect(test.saveLink).toHaveBeenCalledWith(link, test.batch, 0));
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "New note from text" }));
  await waitFor(() => expect(test.saveText).toHaveBeenCalledWith(text));
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  await act(() => pending.resolve());
  await waitFor(() => expect(test.plugin.acknowledge).toHaveBeenCalledTimes(1));
});

it("keeps failed note actions pending and retries on an explicit tap", async () => {
  const test = await fixture([text]);
  test.saveText.mockRejectedValueOnce(new Error("offline"));
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "New note from text" }));
  await screen.findByRole("alert");
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry New note from text" }));
  await waitFor(() => expect(test.plugin.acknowledge).toHaveBeenCalledTimes(1));
});

it("acknowledges an explicitly discarded batch without reading or saving it", async () => {
  const test = await fixture([file, link, text]);
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Discard batch" }));
  await waitFor(() => expect(test.plugin.acknowledge).toHaveBeenCalledTimes(1));
  expect(test.plugin.readChunk).not.toHaveBeenCalled();
  expect(test.uploads.enqueue).not.toHaveBeenCalled();
  expect(test.saveLink).not.toHaveBeenCalled();
});

it("leaves conflict resolution to explicit taps; an explicit item discard completes the batch", async () => {
  const test = await fixture();
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalled());
  await test.update("conflict");
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
  expect(test.uploads.resolve).toHaveBeenCalledWith("upload-1", "keep-both");
  fireEvent.click(screen.getByRole("button", { name: "Discard item" }));
  expect(test.uploads.cancel).toHaveBeenCalledWith("upload-1");
  await waitFor(() => expect(test.plugin.acknowledge).toHaveBeenCalledTimes(1));
});

it("retries failed acknowledgement without re-uploading, including after unmount", async () => {
  const test = await fixture();
  vi.mocked(test.plugin.acknowledge).mockRejectedValueOnce(new Error("busy"));
  const view = test.view();
  fireEvent.click(screen.getByRole("button", { name: "Save to Drive" }));
  await waitFor(() => expect(test.uploads.enqueue).toHaveBeenCalled());
  view.unmount();
  await test.update("done");
  await waitFor(() => expect(test.intake.getSnapshot().error).toBe(true));
  test.view();
  fireEvent.click(screen.getByRole("button", { name: "Retry finishing share" }));
  await waitFor(() => expect(test.intake.getSnapshot().batches).toEqual([]));
  expect(test.uploads.enqueue).toHaveBeenCalledTimes(1);
});

it("keeps shares pending when signed out, and shows an empty state on the web", async () => {
  const test = await fixture();
  const native = { isNativePlatform: () => true, getPlatform: () => "ios" };
  vi.stubGlobal("Capacitor", native);
  const view = render(h(ShareScreen, { intake: test.intake }));
  await screen.findByRole("link", { name: "Sign in" });
  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
    "/signin?next=%2Fshare",
  );
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  view.unmount();
  vi.stubGlobal("Capacitor", undefined);
  vi.mocked(test.plugin.getPending).mockClear();
  render(h(ShareScreen, { intake: test.intake }));
  expect(screen.getByText("Nothing to save")).toBeTruthy();
  expect(test.plugin.getPending).not.toHaveBeenCalled();
});

it("makes an expired share inert, offers shell reauthentication, and keeps the pending batch and progress", async () => {
  const test = await fixture([text]);
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
  const account = {
    id: "solid:alice",
    kind: "solid" as const,
    name: "Alice",
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
  };
  const reauth = vi.fn(async () => account);
  const accounts = {
    status: "ready",
    active: account,
    reauth,
    signOut: vi.fn(),
  } as unknown as AccountsContextValue;
  session.status = "ready";
  session.session = {
    mode: "solid",
    displayName: account.name,
    webId: account.webId,
    storageUrl: account.storageUrl,
    fetch: vi.fn(),
    publicFetch: vi.fn(),
    subscribe: () => () => {},
  };
  drive.mockReturnValue({ driveRoot: "https://pod.example/drive/", uploads: test.uploads });
  actions.saveText.mockRejectedValueOnce(new Error("offline"));
  const tree = (value: AccountsContextValue) =>
    h(AccountsContext, { value }, h(ShareScreen, { intake: test.intake }));
  const view = render(tree(accounts));
  fireEvent.click(await screen.findByRole("button", { name: "New note from text" }));
  await screen.findByRole("button", { name: "Retry New note from text" });
  const pending = test.intake.getSnapshot();

  view.rerender(tree({ ...accounts, status: "expired" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("Your session ended — sign in again to continue");
  const content = view.container.querySelector("[inert]");
  expect(content?.textContent).toContain(text.kind === "text" ? text.text : "");
  expect(test.intake.getSnapshot().batches).toBe(pending.batches);
  expect(test.intake.getSnapshot().progress).toBe(pending.progress);
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
  expect(test.plugin.readChunk).not.toHaveBeenCalled();
  expect(test.uploads.enqueue).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  await waitFor(() => expect(reauth).toHaveBeenCalledOnce());
  view.rerender(tree(accounts));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(view.container.querySelector("[inert]")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry New note from text" })).toBeTruthy();
  expect(actions.saveText).toHaveBeenCalledOnce();
  expect(test.intake.getSnapshot().batches).toBe(pending.batches);
  expect(test.plugin.acknowledge).not.toHaveBeenCalled();
});
