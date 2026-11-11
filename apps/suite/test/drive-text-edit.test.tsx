// AUTHORED-BY Codex GPT-6.1-Sol
import "./drive-ui-dom";
import { createRequire } from "node:module";
import { toast } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PreviewBody, PreviewDialog, PreviewPage } from "../src/apps/drive/components/preview";
import { TextPreview } from "../src/apps/drive/components/text-preview";
import {
  createSolidDriveClient,
  DriveError,
  type DriveItem,
} from "../src/apps/drive/lib/client/client";
import type { DriveContextValue } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, deferred, h, key, mount } from "./drive-ui-dom";

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
let drive: DriveContextValue;
let actions: ReturnType<typeof useDriveActions>;
let ui: ReturnType<typeof useDriveUi>;
function Probe() {
  actions = useDriveActions();
  ui = useDriveUi();
  return null;
}
function contents(children?: ReactNode) {
  return h(DriveUiProvider, null, h(Probe), children);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

async function setup(
  options: {
    preview?: boolean;
    body?: string | Uint8Array;
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
  drive = {
    client,
    driveRoot: DRIVE,
    session: {
      mode: "demo",
      webId: `${ROOT}profile#me`,
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
  if (options.preview)
    await vi.waitFor(() =>
      expect(view.host.querySelector('[aria-label="Loading preview"]')).toBeNull(),
    );
  return { view, item, http, pod, get: within(view.host) };
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

test("New folder uses only guarded inherit-verified provisioning and reports errors", async () => {
  const { pod } = await setup();
  const create = vi.spyOn(drive.client, "createFolder");
  await act(async () =>
    expect(await actions.newFolder(DRIVE, "  New folder  ")).toBe(`${DRIVE}New%20folder/`),
  );
  expect(create).toHaveBeenCalledExactlyOnceWith(`${DRIVE}New%20folder/`, {
    kind: "inherit-verified",
  });
  expect(pod.has(`${DRIVE}New%20folder/`)).toBe(true);
  expect(toast.success).toHaveBeenCalledWith("Created New folder");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  create.mockRejectedValue(new TypeError("Offline"));
  await act(async () => expect(await actions.newFolder(DRIVE, "Later")).toBeUndefined());
  expect(create).toHaveBeenLastCalledWith(`${DRIVE}Later/`, { kind: "inherit-verified" });
  expect(pod.has(`${DRIVE}Later/`)).toBe(false);
  expect(toast.error).toHaveBeenCalled();
});

test("Save carries the GET validator and exact discovery assertion through the guarded client", async () => {
  const { item, view } = await setup();
  const opened = await drive.client.readVersion(FILE);
  vi.spyOn(drive.client, "readVersion").mockResolvedValue(opened);
  await view.render(contents(h(PreviewBody, { item, metadataStatus: "ready" })));
  const get = within(view.host);
  await vi.waitFor(() => expect(get.getByRole("button", { name: "Edit" })).toBeTruthy());
  expect(opened.etag).not.toBe(item.etag);
  const write = vi.spyOn(drive.client, "write").mockResolvedValue({ etag: '"saved-v2"' });
  await editText(get);
  await save(get);
  expect(write).toHaveBeenCalledExactlyOnceWith(
    FILE,
    "Changed text",
    {
      contentType: "text/plain",
      ifMatch: opened.etag,
      verifyHeaders: opened.verifyHeaders,
    },
    { kind: "protect-ancestors" },
  );
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe("Changed text");
  expect(toast.success).toHaveBeenCalledWith("Saved");
  expect(drive.invalidate).toHaveBeenCalledWith(FILE);
  expect(document.activeElement).toBe(get.getByRole("button", { name: "Edit" }));
  await editText(get, "Second edit");
  await save(get);
  expect(write).toHaveBeenLastCalledWith(
    FILE,
    "Second edit",
    expect.objectContaining({ ifMatch: '"saved-v2"' }),
    { kind: "protect-ancestors" },
  );
});

test.each([
  false,
  true,
])("offline Save is disabled and retains the draft (initially offline: %s)", async (initiallyOffline) => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(!initiallyOffline);
  const { get } = await setup({ preview: true });
  const write = vi.spyOn(drive.client, "write");
  await editText(get);
  online.mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event("offline")));
  const button = get.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    document.getElementById(button.getAttribute("aria-describedby") as string)?.textContent,
  ).toBe("You're offline. Reconnect to save.");
  await act(async () => fireEvent.submit(get.getByRole("form")));
  expect(write).not.toHaveBeenCalled();
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  online.mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(button.disabled).toBe(false);
  await save(get);
  expect(write).toHaveBeenCalledOnce();
});

test("412 retains the draft, blocks further saves and offers confirmed Reload", async () => {
  const { get, view, pod } = await setup({ preview: true });
  const write = vi
    .spyOn(drive.client, "write")
    .mockRejectedValue(new DriveError("conflict", 412, FILE));
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
});

test("a save without a returned validator requires Reload before another save", async () => {
  const { get } = await setup({ preview: true });
  vi.spyOn(drive.client, "write").mockResolvedValue({});
  await editText(get);
  await save(get);
  await editText(get, "Changed text");
  expect((get.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  const confirm = vi.spyOn(window, "confirm");
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Reload" })));
  expect(confirm).not.toHaveBeenCalled();
  expect(get.queryByRole("textbox")).toBeNull();
});

test.each([
  "missing",
  "weak",
] as const)("a %s ETag disables Save with a reason and never permits a conditional write", async (etag) => {
  const { get } = await setup({ preview: true, etag });
  const write = vi.spyOn(drive.client, "write");
  await editText(get);
  const button = get.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    document.getElementById(button.getAttribute("aria-describedby") as string)?.textContent,
  ).toContain("current version");
  await act(async () => fireEvent.submit(get.getByRole("form")));
  expect(write).not.toHaveBeenCalled();
});

test("Save uses Drive's guarded conditional write and survives reopening", async () => {
  const { get, item, view } = await setup({ preview: true });
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
  const { get, view } = await setup({ preview: true });
  const pending = deferred<Awaited<ReturnType<typeof drive.client.write>>>();
  const write = vi
    .spyOn(drive.client, "write")
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
  const late = deferred<Awaited<ReturnType<typeof drive.client.write>>>();
  write.mockReturnValueOnce(late.promise);
  await save(get);
  await view.unmount();
  await act(async () => late.resolve({ etag: '"late"' }));
  expect(toast.success).not.toHaveBeenCalled();
});

test("late failures after closing an editor do not surface an error in a different preview", async () => {
  const { get, view } = await setup({ preview: true });
  const late = deferred<Awaited<ReturnType<typeof drive.client.write>>>();
  vi.spyOn(drive.client, "write").mockReturnValueOnce(late.promise);
  await editText(get);
  await save(get);
  await view.unmount();
  await act(async () => late.reject(new Error("Refused")));
  expect(toast.error).not.toHaveBeenCalled();
});

test("text editor obeys caller limits and permission changes even for synthetic submit events", async () => {
  const { item, view } = await setup();
  const write = vi.spyOn(drive.client, "write");
  const value = {
    text: "Text",
    truncated: false,
    writable: true,
    editableEncoding: true,
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

test.each([
  { contentType: "text/plain; charset=windows-1252", body: "ASCII is still unsupported" },
  { contentType: "text/plain; charset=UTF-16", body: new Uint8Array([0xff, 0xfe, 0x41, 0]) },
  {
    contentType: "text/plain; charset=windows-1252",
    body: new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
  },
  { contentType: "text/plain", body: new Uint8Array([0xc3, 0x28]) },
  { contentType: "text/plain; charset=utf-8", body: new Uint8Array([0xff]) },
  { contentType: "text/plain", body: "\uFEFFText with a BOM" },
  { contentType: 'text/plain; charset=""', body: "Text" },
  { contentType: "text/plain; charset", body: "Text" },
  { contentType: "text/plain; charset=utf-8; charset=windows-1252", body: "Text" },
])("unsupported encodings, invalid UTF-8 and BOM files stay preview-only: %#", async (options) => {
  const { get, view } = await setup({ preview: true, ...options });
  const bytes =
    typeof options.body === "string" ? new TextEncoder().encode(options.body) : options.body;
  expect(view.host.querySelector(".drv-preview-text")?.textContent).toBe(
    new TextDecoder().decode(bytes),
  );
  expect(get.queryByRole("button", { name: "Edit" })).toBeNull();
});

test.each([
  ["text/plain", "text/plain"],
  ['text/markdown; CHARSET="UtF-8"', "text/markdown; charset=utf-8"],
  ["text/plain; charset=US-ASCII", "text/plain; charset=utf-8"],
  ["text/plain; format=flowed", "text/plain"],
])("supported encoding saves preserve the media type and declared charset: %s", async (contentType, savedType) => {
  const { get, http } = await setup({ preview: true, contentType });
  const opened = await drive.client.readVersion(FILE);
  expect(opened.contentType).toBe(contentType);
  const write = vi.spyOn(drive.client, "write");
  await editText(get, "Café\n日本語");
  await save(get);
  expect(write).toHaveBeenCalledWith(
    FILE,
    "Café\n日本語",
    expect.objectContaining({ contentType: savedType }),
    { kind: "protect-ancestors" },
  );
  const puts = http.mock.calls.filter(
    ([url, init]) => String(url) === FILE && init?.method === "PUT",
  );
  expect(new Headers(puts.at(-1)?.[1]?.headers).get("content-type")).toBe(savedType);
});

test("a headerless GET retains its bytes, validator and permission without inventing a content type", async () => {
  const { http, pod } = await setup();
  http.mockImplementation(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) === FILE && (init?.method ?? "GET") === "GET")
      response.headers.delete("content-type");
    return response;
  });
  const opened = await drive.client.readVersion(FILE);
  expect(opened.contentType).toBeUndefined();
  expect(opened.etag).toMatch(/^"/);
  expect(opened.writable).toBe(true);
  expect(await opened.body.text()).toBe("Original text");
});

const dismissalPaths = [
  "Close",
  "outside",
  "Escape",
  "Previous file",
  "Next file",
  "ArrowLeft",
  "ArrowRight",
] as const;
type DismissalPath = (typeof dismissalPaths)[number];
async function attemptLeave(path: DismissalPath, get: ReturnType<typeof within>) {
  if (path === "outside") {
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      fireEvent.click(overlay);
    });
  } else if (path === "Escape" || path === "ArrowLeft" || path === "ArrowRight") {
    const dialog = get.getByRole("dialog");
    await act(async () => dialog.focus());
    await key(dialog, path);
  } else await act(async () => fireEvent.click(get.getByRole("button", { name: path })));
}
async function openDialog() {
  const { item, view, pod } = await setup();
  const siblings = ["previous.txt", "next.txt"];
  for (const name of siblings)
    await pod.fetch(`${DRIVE}${name}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: name,
    });
  const previous = await drive.client.stat(`${DRIVE}previous.txt`);
  const next = await drive.client.stat(`${DRIVE}next.txt`);
  await view.render(contents(h(PreviewDialog)));
  await act(async () => ui.setPreview({ items: [previous, item, next], index: 1 }));
  const get = within(document.body);
  await vi.waitFor(() => expect(get.getByRole("button", { name: "Edit" })).toBeTruthy());
  return { get, view };
}
function expectLeft(path: DismissalPath) {
  if (["Close", "outside", "Escape"].includes(path)) expect(ui.preview).toBeUndefined();
  else expect(ui.preview?.index).toBe(path === "Previous file" || path === "ArrowLeft" ? 0 : 2);
}

test.each(
  dismissalPaths,
)("dirty %s requires confirmation and a refusal keeps the same draft", async (path) => {
  const { get } = await openDialog();
  await editText(get);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await attemptLeave(path, get);
  expect(confirm).toHaveBeenCalledExactlyOnceWith("Discard your changes?");
  expect(ui.preview?.index).toBe(1);
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  confirm.mockReturnValue(true);
  await attemptLeave(path, get);
  expectLeft(path);
});

test.each(dismissalPaths)("clean %s can leave without a prompt", async (path) => {
  const { get } = await openDialog();
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  const confirm = vi.spyOn(window, "confirm");
  await attemptLeave(path, get);
  expect(confirm).not.toHaveBeenCalled();
  expectLeft(path);
});

test.each(
  dismissalPaths,
)("saving blocks %s until settlement and a failure retains the draft", async (path) => {
  const { get } = await openDialog();
  const pending = deferred<{ etag?: string }>();
  vi.spyOn(drive.client, "write").mockReturnValue(pending.promise);
  await editText(get);
  await save(get);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await attemptLeave(path, get);
  expect(confirm).not.toHaveBeenCalled();
  expect(ui.preview?.index).toBe(1);
  expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Changed text");
  await act(async () => pending.reject(new DriveError("forbidden", 403, FILE)));
  expect(get.getByRole("alert").textContent).toContain("Your changes are still here");
  await attemptLeave(path, get);
  expect(confirm).toHaveBeenCalledExactlyOnceWith("Discard your changes?");
  expect(ui.preview?.index).toBe(1);
});

function beforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}
test("beforeunload is guarded only while dirty or saving, including a clean in-flight save", async () => {
  const { get } = await setup({ preview: true });
  expect(beforeUnload().defaultPrevented).toBe(false);
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  expect(beforeUnload().defaultPrevented).toBe(false);
  await act(async () => fireEvent.change(get.getByRole("textbox"), { target: { value: "Draft" } }));
  expect(beforeUnload().defaultPrevented).toBe(true);
  await act(async () =>
    fireEvent.change(get.getByRole("textbox"), { target: { value: "Original text" } }),
  );
  expect(beforeUnload().defaultPrevented).toBe(false);
  const pending = deferred<{ etag?: string }>();
  vi.spyOn(drive.client, "write").mockReturnValue(pending.promise);
  await save(get);
  expect(beforeUnload().defaultPrevented).toBe(true);
  await act(async () => pending.resolve({ etag: '"saved"' }));
  expect(beforeUnload().defaultPrevented).toBe(false);
});

test("unmounting a dirty editor removes its preview guard and beforeunload listener", async () => {
  const { get, view } = await setup({ preview: true });
  await editText(get);
  expect(beforeUnload().defaultPrevented).toBe(true);
  await view.render(contents());
  const confirm = vi.spyOn(window, "confirm");
  expect(ui.mayLeavePreview()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(beforeUnload().defaultPrevented).toBe(false);
});

test.each([
  "clean",
  "dirty",
  "saving",
] as const)("direct preview Back to folder guards a %s editor", async (state) => {
  const { item, view } = await setup();
  await view.render(contents(h(PreviewPage, { item, parent: DRIVE })));
  const get = within(view.host);
  await vi.waitFor(() => expect(get.getByRole("button", { name: "Edit" })).toBeTruthy());
  await act(async () => fireEvent.click(get.getByRole("button", { name: "Edit" })));
  if (state !== "clean")
    await act(async () =>
      fireEvent.change(get.getByRole("textbox"), { target: { value: "Draft" } }),
    );
  const pending = deferred<{ etag?: string }>();
  vi.spyOn(drive.client, "write").mockReturnValue(pending.promise);
  if (state === "saving") await save(get);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const back = get.getByRole("link", { name: "Back to folder" });
  expect(back.getAttribute("href")).toBe("/drive/my");
  async function clickBack() {
    let blocked: boolean | undefined;
    document.addEventListener(
      "click",
      (event) => {
        blocked = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    await act(async () => fireEvent.click(back));
    return blocked;
  }
  expect(await clickBack()).toBe(state !== "clean");
  expect(confirm).toHaveBeenCalledTimes(state === "dirty" ? 1 : 0);
  if (state === "dirty") {
    expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft");
    confirm.mockReturnValue(true);
    expect(await clickBack()).toBe(false);
  }
  if (state === "saving") {
    await act(async () => pending.reject(new Error("Network failure")));
    expect(await clickBack()).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect((get.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft");
  }
});
