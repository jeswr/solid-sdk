// AUTHORED-BY Codex
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { UploadDock } from "../src/apps/drive/components/upload-dock";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider } from "../src/apps/drive/state/ui";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function replaceAll() {
  const checkbox = document.querySelector('[role="dialog"] [role="checkbox"]');
  if (!checkbox) throw new Error("Missing Apply to all");
  await click(checkbox);
  await click(button("Replace"));
}

async function setup(hiddenLink = false) {
  const f = await wacPod();
  // HTTP permits a strong ETag derived solely from the representation bytes.
  const urls = new Set<string>();
  const writes: { url: string; match: string | null; none: string | null }[] = [];
  const failures = new Set<string>();
  const etag = async (url: string) => {
    const bytes = await (await f.pod.fetch(url)).arrayBuffer();
    return `"${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}"`;
  };
  f.after(async (url, method, response) => {
    const headers = new Headers(response.headers);
    if (hiddenLink) headers.delete("link");
    if (urls.has(url) && response.ok && ["HEAD", "GET", "PUT"].includes(method))
      headers.set("etag", await etag(url));
    return new Response(response.body, { status: response.status, headers });
  });
  f.intercept(async (url, init) => {
    if (!urls.has(url) || init?.method !== "PUT") return undefined;
    const headers = new Headers(init.headers);
    const match = headers.get("if-match");
    writes.push({ url, match, none: headers.get("if-none-match") });
    if (failures.has(url)) return new Response(null, { status: 503 });
    if (match) {
      const current = await f.pod.fetch(url, { method: "HEAD" });
      if (!current.ok || match !== (await etag(url))) return new Response(null, { status: 412 });
      // Translate the content validator to the underlying fixture's revision validator.
      headers.set("if-match", current.headers.get("etag") as string);
    }
    return f.pod.fetch(url, { ...init, headers });
  });
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    return h(DriveDialogs);
  }
  const tree = () =>
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, h(Probe), h(UploadDock)),
    });
  const view = await mount(tree());
  const settled = (statuses: string[]) =>
    vi.waitFor(async () => {
      await act(async () => {});
      expect(drive.uploads.tasks.map((task) => task.status)).toEqual(statuses);
    });
  return {
    f,
    urls,
    writes,
    failures,
    view,
    tree,
    settled,
    get drive() {
      return drive;
    },
  };
}

it.each([
  false,
  true,
])("Retry asks again before replacing a public empty file with the identical content ETag (hidden Link: %s)", async (hiddenLink) => {
  const env = await setup(hiddenLink);
  const { f, urls, failures, writes, settled } = env;
  const url = `${PUBLIC}report.txt`;
  await f.fetch(url, { method: "PUT", body: "", headers: { "content-type": "text/plain" } });
  f.policies.set(`${url}.policy`, await aclBody(url));
  urls.add(url);
  const approved = (await env.drive.client.stat(url)).etag;
  expect((await f.anonymous(url)).status).toBe(403);
  await act(async () =>
    env.drive.uploads.enqueue(PUBLIC, [new File(["secret contents"], "report.txt")]),
  );
  await settled(["conflict"]);
  failures.add(url);
  await click(button("Replace"));
  await settled(["failed"]);
  failures.clear();
  // Another client moves the owner-only original away while Drive is idle.
  const saved = `${DRIVE}saved-report.txt`;
  await f.fetch(saved, { method: "PUT", body: await (await f.fetch(url)).blob() });
  f.policies.set(`${saved}.policy`, await aclBody(saved));
  await f.fetch(url, { method: "DELETE" });
  await f.fetch(url, { method: "PUT", body: "", headers: { "content-type": "application/pdf" } });
  f.policies.set(`${url}.policy`, await aclBody(url, true));
  expect((await env.drive.client.stat(url)).etag).toBe(approved);
  writes.length = 0;
  f.audit();
  await click(button("Retry report.txt"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(env.drive.uploads.tasks[0]?.status).not.toBe("uploading");
  });
  expect(await (await f.anonymous(url)).text()).toBe("");
  await settled(["conflict"]);
  expect(writes).toEqual([]);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("report.txt");
  expect(dialog?.textContent).toContain("PDF document");
  expect(dialog?.textContent).toContain("0 B");
  await vi.waitFor(() =>
    expect(dialog?.textContent).toContain(hiddenLink ? "Access unknown" : "Anyone with the link"),
  );
  expect(f.exposures).toEqual([]);
  await click(button("Skip"));
  await settled(["skipped"]);
});

it("reselecting a failed replacement after reload asks about the current target and keeps If-Match after confirmation", async () => {
  const env = await setup();
  const { f, urls, failures, settled, writes } = env;
  const url = `${PUBLIC}placeholder`;
  urls.add(url);
  const file = new File(["new contents"], "placeholder");
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await settled(["conflict"]);
  failures.add(url);
  await click(button("Replace"));
  await settled(["failed"]);
  await env.view.unmount();
  failures.clear();
  await f.fetch(url, { method: "PUT", body: "current file" });
  await mount(env.tree());
  // File bytes and approvals are not persisted; replacement intent survives.
  expect(env.drive.uploads.tasks).toEqual([]);
  const current = (await env.drive.client.stat(url)).etag;
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await settled(["conflict"]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("12 B");
  await click(button("Replace"));
  await settled(["done"]);
  expect(writes.at(-1)).toEqual({ url, match: current, none: null });
  expect(await (await env.drive.client.read(url)).text()).toBe("new contents");
});

it("Apply to all asks once for each retry batch, including files beyond the concurrency limit", async () => {
  const env = await setup();
  const { f, urls, failures, settled, writes } = env;
  const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
  for (const name of names) {
    const url = `${PUBLIC}${name}`;
    await f.fetch(url, { method: "PUT", body: "" });
    urls.add(url);
  }
  await act(async () =>
    env.drive.uploads.enqueue(
      PUBLIC,
      names.map((name) => new File([name], name)),
    ),
  );
  await settled(names.map(() => "conflict"));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const url of urls) failures.add(url);
    await replaceAll();
    await settled(names.map(() => "failed"));
    failures.clear();
    writes.length = 0;
    await act(async () => {
      for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
    });
    await settled(names.map(() => "conflict"));
    expect(writes).toEqual([]);
  }
  await replaceAll();
  await settled(names.map(() => "done"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  for (const url of urls) {
    expect(writes.filter((write) => write.url === url && write.match)).toHaveLength(1);
  }
});

it("a renewed Apply to all covers siblings retried later in the same batch", async () => {
  const env = await setup();
  const { f, urls, failures, settled, writes } = env;
  const names = ["a.txt", "b.txt", "c.txt"];
  for (const name of names) {
    const url = `${PUBLIC}${name}`;
    await f.fetch(url, { method: "PUT", body: "" });
    urls.add(url);
  }
  await act(async () =>
    env.drive.uploads.enqueue(
      PUBLIC,
      names.map((name) => new File([name], name)),
    ),
  );
  await settled(["conflict", "conflict", "conflict"]);
  for (const url of urls) failures.add(url);
  await replaceAll();
  await settled(["failed", "failed", "failed"]);
  failures.clear();
  writes.length = 0;
  await act(async () => {
    for (const task of env.drive.uploads.tasks.slice(0, 2)) env.drive.uploads.retry(task.id);
  });
  await settled(["conflict", "conflict", "failed"]);
  await replaceAll();
  await settled(["done", "done", "failed"]);
  await click(button("Retry c.txt"));
  await settled(["done", "done", "done"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(writes.filter((write) => write.url === `${PUBLIC}c.txt`)).toMatchObject([
    { match: `"${createHash("sha256").update("").digest("hex")}"`, none: null },
  ]);
});

it("renewed Apply to all reaches an in-flight retry conflict lookup", async () => {
  const env = await setup();
  const { f, urls, failures, settled } = env;
  const names = ["a.txt", "b.txt", "c.txt"];
  for (const name of names) {
    const url = `${PUBLIC}${name}`;
    await f.fetch(url, { method: "PUT", body: "" });
    urls.add(url);
  }
  await act(async () =>
    env.drive.uploads.enqueue(
      PUBLIC,
      names.map((name) => new File([name], name)),
    ),
  );
  await settled(["conflict", "conflict", "conflict"]);
  for (const url of urls) failures.add(url);
  await replaceAll();
  await settled(["failed", "failed", "failed"]);
  failures.clear();
  const pending = deferred<void>();
  const stat = env.drive.client.stat;
  vi.spyOn(env.drive.client, "stat").mockImplementation(async (url, options) => {
    if (url === `${PUBLIC}c.txt`) await pending.promise;
    return stat(url, options);
  });
  await act(async () => {
    for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
  });
  await settled(["conflict", "conflict", "uploading"]);
  await replaceAll();
  await settled(["done", "done", "uploading"]);
  await act(async () => pending.resolve());
  await settled(["done", "done", "done"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each([
  false,
  true,
])("Retry clears the dock error and renews confirmation for a vanished replacement (previously replace: %s)", async (replace) => {
  const env = await setup();
  const { f, urls, failures, settled, writes } = env;
  const name = replace ? "placeholder" : "new.txt";
  const url = `${PUBLIC}${name}`;
  urls.add(url);
  if (!replace) failures.add(url);
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [new File(["new contents"], name)]));
  if (replace) {
    await settled(["conflict"]);
    failures.add(url);
    await click(button("Replace"));
  }
  await settled(["failed"]);
  expect(document.querySelector(".drv-dock-error")?.textContent).toBe("Upload failed");
  failures.clear();
  await f.fetch(url, { method: "DELETE" });
  const pending = deferred<void>();
  const original = env.drive.client.write;
  const write = vi.spyOn(env.drive.client, "write");
  write.mockImplementationOnce(async (...args) => {
    await pending.promise;
    return original(...args);
  });
  writes.length = 0;
  await click(button(`Retry ${name}`));
  if (replace) {
    await settled(["conflict"]);
    expect(writes).toEqual([]);
    await click(button("Upload"));
  }
  await settled(["uploading"]);
  expect.soft(env.drive.uploads.tasks[0]?.error).toBeUndefined();
  expect.soft(document.querySelector(".drv-dock-error")).toBeNull();
  await act(async () => pending.resolve());
  await settled(["done"]);
  expect(env.drive.uploads.tasks[0]?.error).toBeUndefined();
  expect(document.querySelector(".drv-dock")?.textContent).toContain("1 upload complete");
  expect(document.querySelector(".drv-dock-error")).toBeNull();
  expect(writes).toEqual([{ url, match: null, none: "*" }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
