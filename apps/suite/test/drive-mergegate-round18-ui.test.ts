// AUTHORED-BY Codex
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { aclBody, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

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

function expectCreatedFiles(
  writes: readonly { url: string; match: string | null; none: string | null }[],
  names: readonly string[],
) {
  const emptyEtag = `"${createHash("sha256").update("").digest("hex")}"`;
  expect(writes).toHaveLength(names.length * 2);
  for (const name of names) {
    const url = `${PUBLIC}${name}`;
    expect(writes.filter((write) => write.url === url)).toEqual([
      { url, match: null, none: "*" },
      { url, match: emptyEtag, none: null },
    ]);
  }
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
    if (!urls.has(url) || !["PUT", "DELETE"].includes(init?.method ?? "GET")) return undefined;
    const headers = new Headers(init?.headers);
    const match = headers.get("if-match");
    if (init?.method === "PUT") {
      writes.push({ url, match, none: headers.get("if-none-match") });
      if (failures.has(url)) return new Response(null, { status: 503 });
    }
    if (match) {
      const current = await f.pod.fetch(url, { method: "HEAD" });
      if (!current.ok || match !== (await etag(url))) return new Response(null, { status: 412 });
      // Translate the content validator to the underlying fixture's revision validator.
      headers.set("if-match", current.headers.get("etag") as string);
    }
    if (init?.method === "DELETE") {
      const response = await f.pod.fetch(url, { ...init, headers });
      if (response.ok) f.policies.delete(`${url}.policy`);
      return response;
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
    hideLink: () => {
      hiddenLink = true;
    },
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

async function failedReplacement(env: Awaited<ReturnType<typeof setup>>, names = ["report.txt"]) {
  for (const name of names) {
    const url = `${PUBLIC}${name}`;
    await env.f.fetch(url, { method: "PUT", body: "owner's original" });
    env.f.policies.set(`${url}.policy`, await aclBody(url));
    expect((await env.f.anonymous(url)).status).toBe(403);
    env.urls.add(url);
  }
  await act(async () =>
    env.drive.uploads.enqueue(
      PUBLIC,
      names.map((name) => new File(["secret contents"], name)),
    ),
  );
  await env.settled(names.map(() => "conflict"));
  for (const url of env.urls) env.failures.add(url);
  if (names.length > 1) await replaceAll();
  else await click(button("Replace"));
  await env.settled(names.map(() => "failed"));
  env.failures.clear();
  for (const name of names)
    await env.drive.client.move(`${PUBLIC}${name}`, `${PRIVATE}${name}`, {
      kind: "preserve-source",
    });
  env.writes.length = 0;
  env.f.audit();
}

it.each([
  false,
  true,
])("Retry never publishes a confidential replacement after a same-tab move leaves its URL vacant (hidden Link: %s)", async (hiddenLink) => {
  const env = await setup();
  await failedReplacement(env);
  if (hiddenLink) env.hideLink();
  await click(button("Retry report.txt"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(env.drive.uploads.tasks[0]?.status).not.toBe("uploading");
  });
  expect.soft(env.writes).toEqual([]);
  expect.soft((await env.f.anonymous(`${PUBLIC}report.txt`)).status).toBe(404);
  expect.soft(env.f.exposures).toEqual([]);
  await env.settled(["conflict"]);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain(
    "The file you were replacing is no longer here. Upload as a new file?",
  );
  expect(dialog?.textContent).toContain("report.txt");
  await vi.waitFor(() =>
    expect(dialog?.textContent).toContain(hiddenLink ? "Access unknown" : "Anyone with the link"),
  );
  expect(document.activeElement).toBe(button("Cancel"));
  await click(button("Cancel"));
  await env.settled(["skipped"]);
  expect(env.writes).toEqual([]);
});

it("Upload at a vacant replacement URL conditionally creates a placeholder after renewed confirmation, then uses its receipt", async () => {
  const env = await setup();
  await failedReplacement(env);
  await click(button("Retry report.txt"));
  await env.settled(["conflict"]);
  expect(env.writes).toEqual([]);
  await click(button("Upload"));
  await env.settled(["done"]);
  expectCreatedFiles(env.writes, ["report.txt"]);
  expect(await (await env.f.anonymous(`${PUBLIC}report.txt`)).text()).toBe("secret contents");
});

it.each([
  false,
  true,
])("reload-resume retains replacement intent when the original target is gone (hidden Link: %s)", async (hiddenLink) => {
  const env = await setup();
  await failedReplacement(env);
  await env.view.unmount();
  if (hiddenLink) env.hideLink();
  await mount(env.tree());
  expect(env.drive.uploads.tasks).toEqual([]);
  await act(async () =>
    env.drive.uploads.enqueue(PUBLIC, [new File(["secret contents"], "report.txt")]),
  );
  await env.settled(["conflict"]);
  expect(env.writes).toEqual([]);
  expect(env.f.exposures).toEqual([]);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Upload as a new file?");
  await vi.waitFor(() =>
    expect(dialog?.textContent).toContain(hiddenLink ? "Access unknown" : "Anyone with the link"),
  );
  expect(document.activeElement).toBe(button("Cancel"));
  await click(button("Cancel"));
});

it.each([
  false,
  true,
])("a batch of vanished replacements asks once before creating, including beyond concurrency (reload: %s)", async (reload) => {
  const env = await setup();
  const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
  await failedReplacement(env, names);
  if (reload) {
    await env.view.unmount();
    await mount(env.tree());
    await act(async () =>
      env.drive.uploads.enqueue(
        PUBLIC,
        names.map((name) => new File(["secret contents"], name)),
      ),
    );
  } else {
    await act(async () => {
      for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
    });
  }
  await env.settled(names.map(() => "conflict"));
  expect(env.writes).toEqual([]);
  expect(env.f.exposures).toEqual([]);
  const checkbox = document.querySelector('[role="dialog"] [role="checkbox"]');
  if (!checkbox) throw new Error("Missing Apply to all");
  await click(checkbox);
  await click(button("Upload"));
  await env.settled(names.map(() => "done"));
  expectCreatedFiles(env.writes, names);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("a file appearing after the new-file confirmation is never overwritten", async () => {
  const env = await setup();
  await failedReplacement(env);
  await click(button("Retry report.txt"));
  await env.settled(["conflict"]);
  await env.f.fetch(`${PUBLIC}report.txt`, { method: "PUT", body: "someone else's file" });
  await click(button("Upload"));
  await env.settled(["conflict"]);
  expect(await (await env.f.anonymous(`${PUBLIC}report.txt`)).text()).toBe("someone else's file");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("already exists");
  expect(env.f.exposures).toEqual([]);
  await click(button("Skip"));
});

it.each([
  false,
  true,
])("a batch approval never converts between replacing and creating (existing first: %s)", async (existingFirst) => {
  const env = await setup();
  const names = ["a.txt", "b.txt"];
  await failedReplacement(env, names);
  const existing = `${PUBLIC}${names[existingFirst ? 0 : 1]}`;
  await env.f.fetch(existing, { method: "PUT", body: "current public file" });
  env.writes.length = 0;
  await act(async () => {
    for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
  });
  await env.settled(["conflict", "conflict"]);
  const checkbox = document.querySelector('[role="dialog"] [role="checkbox"]');
  if (!checkbox) throw new Error("Missing Apply to all");
  await click(checkbox);
  await click(button(existingFirst ? "Replace" : "Upload"));
  await env.settled(["done", "conflict"]);
  if (existingFirst) expect(env.writes).toHaveLength(1);
  else expectCreatedFiles(env.writes, [names[0] as string]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    existingFirst ? "Upload as a new file?" : "already exists",
  );
  await click(button(existingFirst ? "Cancel" : "Skip"));
  await env.settled(["done", "skipped"]);
});

it.each([
  "later",
  "in-flight",
])("renewed new-file batch approval covers a sibling retried %s", async (timing) => {
  const env = await setup();
  const names = ["a.txt", "b.txt", "c.txt"];
  await failedReplacement(env, names);
  const pending = deferred<void>();
  const stat = env.drive.client.stat;
  vi.spyOn(env.drive.client, "stat").mockImplementation(async (url, options) => {
    if (url === `${PUBLIC}c.txt` && timing === "in-flight") await pending.promise;
    return stat(url, options);
  });
  await act(async () => {
    for (const task of env.drive.uploads.tasks.slice(0, timing === "later" ? 2 : 3))
      env.drive.uploads.retry(task.id);
  });
  await env.settled(["conflict", "conflict", timing === "later" ? "failed" : "uploading"]);
  const checkbox = document.querySelector('[role="dialog"] [role="checkbox"]');
  if (!checkbox) throw new Error("Missing Apply to all");
  await click(checkbox);
  await click(button("Upload"));
  await env.settled(["done", "done", timing === "later" ? "failed" : "uploading"]);
  if (timing === "later") await click(button("Retry c.txt"));
  else await act(async () => pending.resolve());
  await env.settled(["done", "done", "done"]);
  expectCreatedFiles(env.writes, names);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("a failed new-file batch attempt requires another confirmation on Retry", async () => {
  const env = await setup();
  const names = ["a.txt", "b.txt"];
  await failedReplacement(env, names);
  await act(async () => {
    for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
  });
  await env.settled(["conflict", "conflict"]);
  const checkbox = document.querySelector('[role="dialog"] [role="checkbox"]');
  if (!checkbox) throw new Error("Missing Apply to all");
  await click(checkbox);
  for (const url of env.urls) env.failures.add(url);
  await click(button("Upload"));
  await env.settled(["failed", "failed"]);
  env.failures.clear();
  env.writes.length = 0;
  await act(async () => {
    for (const task of env.drive.uploads.tasks) env.drive.uploads.retry(task.id);
  });
  await env.settled(["conflict", "conflict"]);
  expect(env.writes).toEqual([]);
  expect(env.f.exposures).toEqual([]);
  await click(button("Cancel"));
  expect(document.activeElement).toBe(button("Cancel"));
  await click(button("Cancel"));
  await env.settled(["skipped", "skipped"]);
});
