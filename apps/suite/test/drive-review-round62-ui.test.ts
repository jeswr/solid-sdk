// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, type DriveClient } from "../src/apps/drive/lib/client/client";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

const mocks = vi.hoisted(() => ({
  client: undefined as DriveClient | undefined,
  invalidate: vi.fn(),
  error: vi.fn(),
}));
const { IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBObjectStore: { prototype: IDBObjectStore } };
afterEach(() => vi.restoreAllMocks());
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: { error: mocks.error },
}));

vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({
    driveRoot: "https://pod.test/drive/",
    client: mocks.client,
    invalidate: mocks.invalidate,
  }),
}));
vi.mock("../src/apps/drive/state/ui", () => ({
  useDriveUi: () => ({ currentFolder: "https://pod.test/drive/" }),
}));

import { ProtectionBanner } from "../src/apps/drive/components/protection-banner";
import { NewMenu } from "../src/apps/drive/components/sidebar";

it("round 62: New document stays disabled without a nonexistent route", async () => {
  await mount(h(NewMenu, { open: true }));
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) =>
    node.textContent?.includes("New document"),
  );
  if (!item) throw new Error("Missing New document");
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.closest("a")).toBeNull();
  expect(item.querySelector("a")).toBeNull();
  await click(item);
  await key(item, "Enter");
  expect(window.location.pathname).toBe("/drive/my");
});

it.each([
  "file",
  "folder",
])("round 62 shape a: protection Delete keeps the displayed %s validator", async (kind) => {
  const f = await rdfPod();
  const url = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder") await f.pod.fetch(url, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  mocks.client = client;
  const item = { ...(await client.stat(url)), protectionRequired: true as const };
  const view = await mount(h(ProtectionBanner, { item }));
  await f.pod.fetch(url, {
    method: "PUT",
    body: kind === "folder" ? "" : "another client's bytes",
  });
  const selected = [...view.host.querySelectorAll("button")].find(
    (node) => node.textContent === "Delete",
  );
  if (!selected) throw new Error("Missing Delete");
  await click(selected);
  expect(f.pod.has(url)).toBe(true);
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
  expect(view.host.textContent).toContain("sharing");
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining("Refresh and confirm deletion again"),
  );
});

it.each([
  undefined,
  'W/"weak"',
])("round 62: protection Delete refuses an unconfirmed validator %s", async (etag) => {
  const remove = vi.fn();
  mocks.client = {
    remove,
    stat: vi.fn(async () => ({ url: `${PRIVATE}secret`, etag })),
  } as unknown as DriveClient;
  const view = await mount(
    h(ProtectionBanner, {
      item: {
        url: `${PRIVATE}secret`,
        name: "secret",
        kind: "file",
        protectionRequired: true,
        ...(etag ? { etag } : {}),
      },
    }),
  );
  const selected = [...view.host.querySelectorAll("button")].find(
    (node) => node.textContent === "Delete",
  );
  if (!selected) throw new Error("Missing Delete");
  await click(selected);
  expect(remove).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining("Refresh and confirm deletion again"),
  );
});

it.each([
  "file",
  "folder",
])("round 62 shape b: protection %s Delete performs no local async work after the final HTTP check", async (kind) => {
  const f = await rdfPod();
  const url = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder") await f.pod.fetch(url, { method: "PUT", body: "" });
  const events: string[] = [];
  const http: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    if (method === "DELETE") expect(events.at(-1)).toBe("identity HEAD");
    const response = await f.fetch(input, init);
    events.push(
      method === "HEAD" && new Headers(init?.headers).has("if-match") ? "identity HEAD" : method,
    );
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  mocks.client = client;
  const item = { ...(await client.stat(url)), protectionRequired: true as const };
  const view = await mount(h(ProtectionBanner, { item }));
  for (const method of ["get", "getAllKeys", "put", "delete"] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      events.push("IndexedDB");
      return Reflect.apply(original, this, args);
    });
  }
  const locks = navigator.locks;
  const request = locks.request.bind(locks);
  vi.spyOn(locks, "request").mockImplementation((...args: Parameters<typeof locks.request>) => {
    events.push("Web Lock");
    return Reflect.apply(request, locks, args);
  });
  const selected = [...view.host.querySelectorAll("button")].find(
    (node) => node.textContent === "Delete",
  );
  if (!selected) throw new Error("Missing Delete");
  await click(selected);
  expect(f.calls).toContainEqual({ url, method: "DELETE" });
  expect(f.pod.has(url)).toBe(false);
});

it("round 62: protection Delete hydrates an unversioned listing before confirmation and keeps that capture", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  mocks.client = client;
  const selected = await client.stat(url);
  const { etag: _etag, ...row } = selected;
  const pending = deferred<typeof selected>();
  vi.spyOn(client, "stat").mockReturnValueOnce(pending.promise);
  const view = await mount(h(ProtectionBanner, { item: { ...row, protectionRequired: true } }));
  const button = [...view.host.querySelectorAll("button")].find(
    (node) => node.textContent === "Delete",
  );
  if (!button) throw new Error("Missing Delete");
  expect(button.disabled).toBe(true);
  await act(async () => pending.resolve(selected));
  expect(button.disabled).toBe(false);
  await f.pod.fetch(url, { method: "PUT", body: "another client's bytes" });
  await click(button);
  expect(await (await f.pod.fetch(url)).text()).toBe("another client's bytes");
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
});
