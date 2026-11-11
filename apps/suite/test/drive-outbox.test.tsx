// AUTHORED-BY Codex GPT-6.1-Sol
import "./drive-ui-dom";
import { createRequire } from "node:module";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { toast } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PreviewBody, PreviewDialog } from "../src/apps/drive/components/preview";
import { TextPreview } from "../src/apps/drive/components/text-preview";
import {
  createSolidDriveClient,
  DriveError,
  type DriveItem,
} from "../src/apps/drive/lib/client/client";
import type { DriveContextValue } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { OutboxSessionProvider, useOutboxSession } from "../src/shell/sync/outbox-session";
import { act, deferred, h, key, mount } from "./drive-ui-dom";

const fixture = vi.hoisted(() => ({ accounts: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => fixture.accounts }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => drive }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { fireEvent, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");

const ROOT = "https://pod.example/";
const DRIVE = `${ROOT}drive/`;
const FILE = `${DRIVE}note.txt`;
const QUEUED = "Saved on this device. It will sync when you're back online.";
let drive: DriveContextValue;
let actions: ReturnType<typeof useDriveActions>;
let ui: ReturnType<typeof useDriveUi>;
let outbox: ReturnType<typeof useOutboxSession>;
function Probe() {
  actions = useDriveActions();
  ui = useDriveUi();
  outbox = useOutboxSession();
  return null;
}
function contents(children?: ReactNode) {
  return h(OutboxSessionProvider, { children: h(DriveUiProvider, null, h(Probe), children) });
}
beforeEach(() => {
  vi.mocked(createPodClient).mockReset();
  outbox = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

async function setup(
  options: {
    storage?: boolean;
    preview?: boolean;
    body?: string;
    contentType?: string;
    etag?: "missing" | "weak";
    permission?: string | null;
  } = {},
) {
  const contentType = options.contentType ?? "text/plain";
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/note.txt", body: options.body ?? "Original text", contentType }],
  });
  const http = vi.fn<typeof fetch>(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) === FILE && (init?.method ?? "GET") === "GET") {
      if (options.etag === "missing") response.headers.delete("etag");
      if (options.etag === "weak") response.headers.set("etag", 'W/"weak"');
      if (options.permission === null) response.headers.delete("wac-allow");
      else if (options.permission !== undefined)
        response.headers.set("wac-allow", options.permission);
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  const raw = createMemoryStorage({ root: ROOT });
  await raw.create(ROOT, null, { name: "drive", kind: "container" });
  const account = {
    id: "alice",
    name: "Alice",
    webId: `${ROOT}profile#me`,
    storageUrl: ROOT,
    kind: options.storage === false ? "demo" : "solid",
  } as const;
  fixture.accounts = {
    active: account,
    status: "ready",
    fetch: http,
    isActiveAccount: () => true,
  } as unknown as AccountsContextValue;
  vi.mocked(createPodClient).mockResolvedValue({ storage: raw } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  drive = {
    client,
    driveRoot: DRIVE,
    session: {
      mode: "demo",
      webId: account.webId,
      storageUrl: ROOT,
      displayName: "Alice",
      fetch: http,
      subscribe: pod.subscribe,
      reset: vi.fn(),
    },
    prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
    updatePrefs: vi.fn(),
    invalidate: vi.fn(),
    changes: { subscribe: () => () => {}, subscribeSubtree: () => () => {} },
  } as unknown as DriveContextValue;
  // Deliberately disagree with the GET: saves must use the GET's validator.
  const item: DriveItem = { ...(await client.stat(FILE)), etag: '"head-only-hint"' };
  const view = await mount(
    contents(options.preview ? h(PreviewBody, { item, metadataStatus: "ready" }) : undefined),
  );
  if (options.storage !== false) await vi.waitFor(() => expect(outbox?.storage).toBeTruthy());
  if (options.preview)
    await vi.waitFor(() =>
      expect(view.host.querySelector('[aria-label="Loading preview"]')).toBeNull(),
    );
  return { view, item, raw, http, pod, get: within(view.host) };
}
async function editText(get: ReturnType<typeof within>, text = "Changed text") {
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  const textarea = get.getByRole("textbox", { name: "Edit note.txt" });
  expect(document.activeElement).toBe(textarea);
  await act(async () => fireEvent.change(textarea, { target: { value: text } }));
  return textarea;
}
async function save(get: ReturnType<typeof within>) {
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Save" })));
}

test("online New folder uses the guarded inherit-verified path and never touches outbox storage", async () => {
  const { raw, pod } = await setup();
  const guarded = vi.spyOn(drive.client, "createFolder");
  const create = vi.spyOn(raw, "create");
  await act(async () =>
    expect(await actions.newFolder(DRIVE, "  New folder  ")).toBe(`${DRIVE}New%20folder/`),
  );
  expect(guarded).toHaveBeenCalledExactlyOnceWith(`${DRIVE}New%20folder/`, {
    kind: "inherit-verified",
  });
  expect(create).not.toHaveBeenCalled();
  expect(outbox?.outbox.pending()).toEqual([]);
  expect(pod.has(`${DRIVE}New%20folder/`)).toBe(true);
  expect(toast.success).toHaveBeenCalledWith("Created New folder");
});

test("offline New folder durably queues a normalized create-only container and replay clashes become conflicts", async () => {
  const { raw, pod } = await setup();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const guarded = vi.spyOn(drive.client, "createFolder");
  const create = vi.spyOn(raw, "create");
  await act(async () =>
    expect(await actions.newFolder(DRIVE, "  Café  ")).toBe(`${DRIVE}Caf%C3%A9/`),
  );
  expect(guarded).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(pod.has(`${DRIVE}Caf%C3%A9/`)).toBe(false);
  expect(drive.invalidate).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith(QUEUED);
  expect(outbox?.outbox.pending()).toMatchObject([
    { op: "create", url: `${DRIVE}Caf%C3%A9/`, name: "Café", size: 0 },
  ]);
  await raw.create(DRIVE, null, { name: "Café", kind: "container" });
  // Solid's named PUT reports a taken name as HTTP 412; memory uses 409.
  create.mockRejectedValueOnce(
    new StorageError("conflict", { method: "PUT", url: `${DRIVE}Caf%C3%A9/`, status: 412 }),
  );
  await act(async () => outbox?.adapter.reconnected());
  expect(create).toHaveBeenLastCalledWith(
    DRIVE,
    null,
    expect.objectContaining({ name: "Café", kind: "container" }),
  );
  expect(outbox?.outbox.conflicts()).toHaveLength(1);
});

test("Drive refreshes its listing after replay without requiring focus, and does not refresh just for enqueue", async () => {
  const { view, raw, http } = await setup();
  const actual = await vi.importActual<typeof import("../src/apps/drive/state/drive-context")>(
    "../src/apps/drive/state/drive-context",
  );
  function Listing() {
    const listing = actual.useFolder(DRIVE);
    return h(
      "div",
      null,
      listing.status === "ready"
        ? listing.items.map((item) => item.name).join(", ")
        : listing.status,
    );
  }
  // Real shell sessions do not forward the demo pod's local mutation events.
  const session = { ...drive.session, subscribe: () => () => {} };
  await view.render(contents(h(actual.DriveProvider, { session, children: h(Listing) })));
  await vi.waitFor(() => expect(view.host.textContent).toContain("note.txt"));
  await act(async () => {});
  const lists = () =>
    http.mock.calls.filter(
      ([input, init]) => String(input) === DRIVE && (init?.method ?? "GET") === "GET",
    ).length;
  const before = lists();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => actions.newFolder(DRIVE, "Synced"));
  expect(lists()).toBe(before);
  expect(view.host.textContent).not.toContain("Synced");
  vi.spyOn(raw, "create").mockImplementationOnce(async () => {
    await drive.client.createFolder(`${DRIVE}Synced/`, { kind: "inherit-verified" });
    return {
      url: `${DRIVE}Synced/`,
      etag: (await drive.client.stat(`${DRIVE}Synced/`)).etag as string,
      created: true,
    };
  });
  online.mockReturnValue(true);
  await act(async () => outbox?.adapter.reconnected());
  await vi.waitFor(() => expect(view.host.textContent).toContain("Synced"));
  expect(lists()).toBeGreaterThan(before);
});

test("a network TypeError before the first guarded response falls back to durable container creation", async () => {
  const { http, raw } = await setup();
  http.mockRejectedValue(new TypeError("Failed to fetch"));
  vi.spyOn(raw, "create").mockRejectedValue(new TypeError("Failed to fetch"));
  await act(async () => expect(await actions.newFolder(DRIVE, "Later")).toBe(`${DRIVE}Later/`));
  expect(outbox?.outbox.pending()).toMatchObject([{ op: "create", name: "Later" }]);
  expect(toast.success).toHaveBeenCalledWith(QUEUED);
});

test("an unanswered network failure can recover through storage.create online and use its returned URL", async () => {
  const { http, raw } = await setup();
  http.mockRejectedValue(new TypeError("Failed to fetch"));
  const create = vi.spyOn(raw, "create");
  await act(async () =>
    expect(await actions.newFolder(DRIVE, "Recovered")).toBe(`${DRIVE}Recovered/`),
  );
  expect(create).toHaveBeenCalledExactlyOnceWith(DRIVE, null, {
    name: "Recovered",
    kind: "container",
  });
  expect(outbox?.outbox.pending()).toEqual([]);
  expect(toast.success).toHaveBeenCalledWith("Created Recovered");
});

test.each([
  new TypeError("Invalid local input"),
  "Local refusal",
])("unclassified local failures never authorize queue fallback: %s", async (failure) => {
  const { raw } = await setup();
  const create = vi.spyOn(raw, "create");
  vi.spyOn(drive.client, "createFolder").mockRejectedValue(failure);
  await act(async () => expect(await actions.newFolder(DRIVE, "Refused")).toBeUndefined());
  expect(create).not.toHaveBeenCalled();
  expect(outbox?.outbox.pending()).toEqual([]);
});

test("a local database TypeError before HTTP is an error, never a network fallback", async () => {
  const { http, raw } = await setup();
  http.mockClear();
  const create = vi.spyOn(raw, "create");
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new TypeError("Local database unavailable");
  });
  await act(async () => expect(await actions.newFolder(DRIVE, "Refused")).toBeUndefined());
  expect(create).not.toHaveBeenCalled();
  expect(http).not.toHaveBeenCalled();
  expect(outbox?.outbox.pending()).toEqual([]);
});

test.each([401, 403, 412, 500])("a guarded HTTP %s refusal never queues", async (status) => {
  const { http, raw } = await setup();
  http.mockResolvedValue(new Response(null, { status }));
  const create = vi.spyOn(raw, "create");
  await act(async () => expect(await actions.newFolder(DRIVE, "Refused")).toBeUndefined());
  expect(create).not.toHaveBeenCalled();
  expect(outbox?.outbox.pending()).toEqual([]);
  expect(toast.error).toHaveBeenCalled();
});

test("a TypeError after a guarded HTTP answer never queues", async () => {
  const { http, raw, pod } = await setup();
  http.mockClear();
  let answered = false;
  http.mockImplementation(async (input, init) => {
    if (answered) throw new TypeError("Connection lost after a response");
    answered = true;
    return pod.fetch(input, init);
  });
  const create = vi.spyOn(raw, "create");
  await act(async () => expect(await actions.newFolder(DRIVE, "Partial")).toBeUndefined());
  expect(http.mock.calls.length).toBeGreaterThan(1);
  expect(create).not.toHaveBeenCalled();
  expect(outbox?.outbox.pending()).toEqual([]);
  expect(toast.error).toHaveBeenCalled();
});

test("offline without an outbox preserves the guarded error, and invalid or foreign names never queue", async () => {
  const { http } = await setup({ storage: false });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  http.mockRejectedValue(new TypeError("Offline"));
  const guarded = vi.spyOn(drive.client, "createFolder");
  await act(async () => expect(await actions.newFolder(DRIVE, "Later")).toBeUndefined());
  expect(guarded).toHaveBeenCalledOnce();
  expect(outbox).toBeNull();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("could not be established"));
  await act(async () =>
    expect(await actions.newFolder("https://foreign.example/", "Later")).toBeUndefined(),
  );
  await act(async () => expect(await actions.newFolder(DRIVE, "..")).toBeUndefined());
  expect(guarded).toHaveBeenCalledOnce();
});

test("Edit and Save use the GET ETag, retain the returned ETag for a second edit, and restore focus", async () => {
  const { get, raw, item, view } = await setup({ preview: true });
  const loaded = await drive.client.readVersion(FILE);
  expect(loaded.etag).not.toBe(item.etag);
  const write = vi
    .spyOn(raw, "write")
    .mockResolvedValue({ url: FILE, etag: '"saved-v2"', created: false });
  const guarded = vi.spyOn(drive.client, "write");
  await editText(get);
  await save(get);
  expect(write).toHaveBeenCalledWith(FILE, new TextEncoder().encode("Changed text"), {
    contentType: "text/plain",
    ifMatch: loaded.etag,
  });
  expect(guarded).not.toHaveBeenCalled();
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Changed text");
  expect(document.activeElement).toBe(get.getByRole("button", { name: "Edit" }));
  await editText(get, "Second edit");
  await save(get);
  expect(write).toHaveBeenLastCalledWith(FILE, new TextEncoder().encode("Second edit"), {
    contentType: "text/plain",
    ifMatch: '"saved-v2"',
  });
});

test.each([
  "offline",
  "network",
])("%s text Save durably queues its body and validator, shows the toast and retains local text during refresh", async (failure) => {
  const { get, raw, item, view } = await setup({ preview: true });
  const etag = (await drive.client.readVersion(FILE)).etag;
  const write = vi.spyOn(raw, "write").mockRejectedValue(new TypeError("Network failure"));
  if (failure === "offline") vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await editText(get);
  await save(get);
  expect(toast.success).toHaveBeenCalledWith(QUEUED);
  expect(drive.invalidate).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(failure === "offline" ? 0 : 1);
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Changed text");
  const pending = outbox?.outbox.pending()[0];
  expect(pending).toMatchObject({ op: "write", url: FILE, contentType: "text/plain" });
  expect(
    new TextDecoder().decode((await outbox?.outbox.localBody(pending?.id as string)) as Uint8Array),
  ).toBe("Changed text");
  const replay = vi
    .spyOn(raw, "write")
    .mockRejectedValue(
      new StorageError("precondition-failed", { method: "PUT", url: FILE, status: 412 }),
    );
  await act(async () => outbox?.adapter.reconnected());
  expect(replay).toHaveBeenLastCalledWith(
    FILE,
    expect.any(Uint8Array),
    expect.objectContaining({ ifMatch: etag }),
  );
  expect(outbox?.outbox.conflicts()).toHaveLength(1);
  await view.render(
    contents(
      h(PreviewBody, { item: { ...item, etag: '"background-version"' }, metadataStatus: "ready" }),
    ),
  );
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Changed text");
});

test.each([
  "storage",
  "guarded",
])("an online 412 from %s retains the draft and offers confirmed Reload without overwrite", async (path) => {
  const { get, raw, view, pod } = await setup({ preview: true, storage: path === "storage" });
  const write =
    path === "storage"
      ? vi
          .spyOn(raw, "write")
          .mockRejectedValue(
            new StorageError("precondition-failed", { method: "PUT", url: FILE, status: 412 }),
          )
      : vi.spyOn(drive.client, "write").mockRejectedValue(new DriveError("conflict", 412, FILE));
  await editText(get);
  await save(get);
  expect(get.getByRole("alert").textContent).toBe("This file changed since you opened it");
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  expect((get.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.submit(get.getByRole("form")));
  expect(write).toHaveBeenCalledOnce();
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Reload" })));
  expect(get.queryByRole("textbox")).not.toBeNull();
  await pod.fetch(FILE, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: "Their version",
  });
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Reload" })));
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Their version"),
  );
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(outbox?.outbox.pending() ?? []).toEqual([]);
});

test.each([
  "missing",
  "weak",
] as const)("a %s ETag disables Save with a reason and never permits a conditional write", async (etag) => {
  const { get, raw } = await setup({ preview: true, etag });
  const write = vi.spyOn(raw, "write");
  await editText(get);
  const button = get.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    document.getElementById(button.getAttribute("aria-describedby") as string)?.textContent,
  ).toContain("current version");
  await act(async () => fireEvent.submit(get.getByRole("form")));
  expect(write).not.toHaveBeenCalled();
});

test("demo Save uses Drive's guarded conditional write and survives reopening", async () => {
  const { get, item, view } = await setup({ preview: true, storage: false });
  const opened = await drive.client.readVersion(FILE);
  const write = vi.spyOn(drive.client, "write");
  await editText(get);
  await save(get);
  expect(write).toHaveBeenCalledWith(
    FILE,
    "Changed text",
    { contentType: "text/plain", ifMatch: opened.etag, verifyHeaders: expect.any(Function) },
    { kind: "protect-ancestors" },
  );
  expect(outbox).toBeNull();
  expect(document.activeElement).toBe(get.getByRole("button", { name: "Edit" }));
  await view.render(contents());
  await view.render(contents(h(PreviewBody, { item, metadataStatus: "ready" })));
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Changed text"),
  );
});

test.each([
  { body: "x".repeat(1024 * 1024 + 1) },
  { contentType: "text/csv" },
  { contentType: "text/html" },
  { contentType: "application/json" },
  { permission: 'user="read",public="read write"' },
  { permission: "" },
  { permission: null },
  { permission: 'user="read custom-write"' },
])("oversize, non-text and read-only files have no Edit: case %#", async (options) => {
  const { get } = await setup({ preview: true, ...options });
  expect(get.queryByRole("button", { name: "Edit" })).toBeNull();
});

test("Markdown and an exactly 1 MiB plain text file can be edited", async () => {
  const { get, view } = await setup({ preview: true, contentType: "text/markdown" });
  expect(get.getByRole("button", { name: "Edit" })).toBeTruthy();
  await view.unmount();
  const large = await setup({ preview: true, body: "x".repeat(1024 * 1024) });
  expect(large.get.getByRole("button", { name: "Edit" })).toBeTruthy();
});

test("Escape and Cancel preserve changed drafts until confirmed, and return focus to Edit", async () => {
  const { get } = await setup({ preview: true });
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  const textarea = await editText(get);
  await key(textarea, "ArrowRight");
  await key(textarea, "Escape");
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Cancel" })));
  expect(get.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(get.getByRole("button", { name: "Edit" }));
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  await key(get.getByRole("textbox"), "Escape");
  expect(get.queryByRole("textbox")).toBeNull();
  expect(confirm).toHaveBeenCalledTimes(2);
});

test("Escape from the editor's buttons cannot dismiss the preview and unchanged Escape cancels without asking", async () => {
  const { item, view } = await setup();
  await view.render(contents(h(PreviewDialog)));
  await act(async () => ui.setPreview({ items: [item], index: 0 }));
  const get = within(document.body);
  await vi.waitFor(() => expect(get.getByRole("button", { name: "Edit" })).toBeTruthy());
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  const confirm = vi.spyOn(window, "confirm");
  const cancel = get.getByRole("button", { name: "Cancel" });
  await act(async () => cancel.focus());
  await key(cancel, "Escape");
  expect(ui.preview).toBeDefined();
  expect(get.queryByRole("textbox")).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

test("a failed Save keeps the draft for retry, blocks duplicate submits/cancel, and ignores completion after unmount", async () => {
  const { get, raw, view } = await setup({ preview: true });
  const pending = deferred<Awaited<ReturnType<typeof raw.write>>>();
  const write = vi
    .spyOn(raw, "write")
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("Refused"));
  await editText(get);
  await save(get);
  await act(async () => fireEvent.submit(get.getByRole("form")));
  await key(get.getByRole("textbox"), "Escape");
  expect(write).toHaveBeenCalledOnce();
  expect((get.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => pending.reject(new Error("Refused")));
  expect(get.getByRole("alert").textContent).toContain("Your changes are still here");
  await save(get);
  expect(write).toHaveBeenCalledTimes(2);
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  const late = deferred<Awaited<ReturnType<typeof raw.write>>>();
  write.mockReturnValueOnce(late.promise);
  await save(get);
  await view.unmount();
  await act(async () => late.resolve({ url: FILE, etag: '"late"', created: false }));
  expect(toast.success).not.toHaveBeenCalled();
});

test("late failures after closing an editor do not surface an error in a different preview", async () => {
  const { get, raw, view } = await setup({ preview: true });
  const late = deferred<Awaited<ReturnType<typeof raw.write>>>();
  vi.spyOn(raw, "write").mockReturnValueOnce(late.promise);
  await editText(get);
  await save(get);
  await view.unmount();
  await act(async () => late.reject(new Error("Refused")));
  expect(toast.error).not.toHaveBeenCalled();
});

test("text editor obeys caller limits and permission changes even for synthetic submit events", async () => {
  const { item, view, raw } = await setup();
  const write = vi.spyOn(raw, "write");
  const value = {
    text: "Text",
    truncated: false,
    writable: true,
    etag: '"v1"',
    contentType: "text/plain",
  };
  const reload = vi.fn();
  for (const changed of [
    { ...item, kind: "folder" as const },
    { ...item, size: 1024 * 1024 + 1 },
    { ...item, url: "https://foreign.example/note.txt" },
  ]) {
    await view.render(
      contents(h(TextPreview, { item: changed, value, reload, fallback: "Loading" })),
    );
    expect(within(view.host).queryByRole("button", { name: "Edit" })).toBeNull();
  }
  await view.render(contents(h(TextPreview, { item, value, reload, fallback: "Loading" })));
  const get = within(view.host);
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  await view.render(
    contents(
      h(TextPreview, {
        item: { ...item, size: 1024 * 1024 + 1 },
        value,
        reload,
        fallback: "Loading",
      }),
    ),
  );
  await act(async () => fireEvent.submit(get.getByRole("form")));
  expect(write).not.toHaveBeenCalled();
});
