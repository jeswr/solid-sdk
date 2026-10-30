// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

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
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { toast } from "@jeswr/suite-ui";
import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { PreviewBody } from "../src/apps/drive/components/preview";
import { UploadDock } from "../src/apps/drive/components/upload-dock";
import { DriveProvider, useDrive, useFolder } from "../src/apps/drive/state/drive-context";
import { useLiveResource } from "../src/apps/drive/state/resource";
import { DriveUiProvider, useDriveActions } from "../src/apps/drive/state/ui";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
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

async function setup() {
  const f = await wacPod();
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
  let actions!: ReturnType<typeof useDriveActions>;
  function Probe() {
    drive = useDrive();
    actions = useDriveActions();
    return h(DriveDialogs);
  }
  const tree = (children: ReactNode = h(UploadDock)) =>
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, h(Probe), children),
    });
  const view = await mount(tree());
  const settled = (statuses: string[]) =>
    vi.waitFor(async () => {
      await act(async () => {});
      expect(drive.uploads.tasks.map((task) => task.status)).toEqual(statuses);
    });
  return {
    f,
    view,
    tree,
    settled,
    get drive() {
      return drive;
    },
    get actions() {
      return actions;
    },
  };
}

it.each([
  false,
  true,
])("skipping a reselected duplicate preserves the failed job's conflict across reload (hidden Link: %s)", async (hiddenLink) => {
  const env = await setup();
  const url = `${PUBLIC}report.txt`;
  const file = new File(["secret contents"], "report.txt");
  await env.f.fetch(url, { method: "PUT", body: "original" });
  env.f.policies.set(`${url}.policy`, await aclBody(url));
  expect((await env.f.anonymous(url)).status).toBe(403);
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await env.settled(["conflict"]);
  const originalId = env.drive.uploads.tasks[0]?.id;
  env.f.intercept(async (target, init) =>
    target === url && init?.method === "PUT" ? new Response(null, { status: 503 }) : undefined,
  );
  await click(button("Replace"));
  await env.settled(["failed"]);
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await env.settled(["failed", "conflict"]);
  await click(button("Skip"));
  await env.settled(["failed", "skipped"]);
  const history = () =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("suite.drive.upload-job."))
      .map((key) => JSON.parse(sessionStorage.getItem(key) as string));
  expect(history()).toEqual([{ id: originalId, targetUrl: url, conflictSeen: true }]);
  env.f.intercept(undefined);
  await env.drive.client.move(url, `${PRIVATE}report.txt`, { kind: "preserve-source" });
  await env.view.unmount();
  if (hiddenLink)
    env.f.after(async (_url, _method, response) => {
      const headers = new Headers(response.headers);
      headers.delete("link");
      return new Response(response.body, { status: response.status, headers });
    });
  const writes: string[] = [];
  env.f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT") writes.push(target);
    return undefined;
  });
  env.f.audit();
  await mount(env.tree());
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(env.drive.uploads.tasks[0]?.status).not.toBe("uploading");
  });
  expect.soft(writes).toEqual([]);
  expect.soft(env.f.exposures).toEqual([]);
  expect.soft((await env.f.anonymous(url)).status).toBe(404);
  expect(env.drive.uploads.tasks[0]?.status).toBe("conflict");
  expect(env.drive.uploads.tasks[0]?.id).toBe(originalId);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("The file you were replacing is no longer here");
  await vi.waitFor(() =>
    expect(dialog?.textContent).toContain(hiddenLink ? "Access unknown" : "Anyone with the link"),
  );
  await click(button("Cancel"));
  await env.settled(["skipped"]);
  expect(history()).toEqual([]);
});

it("resume after reload remembers a conflict even before Replace was approved", async () => {
  const env = await setup();
  const url = `${PUBLIC}placeholder`;
  const file = new File(["secret contents"], "placeholder");
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await env.settled(["conflict"]);
  await env.view.unmount();
  await env.drive.client.move(url, `${PRIVATE}placeholder`, { kind: "preserve-source" });
  env.f.audit();
  await mount(env.tree());
  const resumedWrites = vi.spyOn(env.drive.client, "write");
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(env.drive.uploads.tasks[0]?.status).not.toBe("uploading");
  });
  expect.soft(resumedWrites).not.toHaveBeenCalled();
  expect.soft(env.f.exposures).toEqual([]);
  expect(env.drive.uploads.tasks[0]?.status).toBe("conflict");
  await click(button("Cancel"));
});

it.each([
  false,
  true,
])("a failed fresh upload rechecks an occupied URL before writing on retry (reload: %s)", async (reload) => {
  const env = await setup();
  const url = `${PUBLIC}report.txt`;
  const file = new File(["secret contents"], "report.txt");
  env.f.intercept(async (target, init) =>
    target === url && init?.method === "PUT" ? new Response(null, { status: 503 }) : undefined,
  );
  await act(async () => env.drive.uploads.enqueue(PUBLIC, [file]));
  await env.settled(["failed"]);
  env.f.intercept(undefined);
  await env.f.fetch(url, { method: "PUT", body: "current public file" });
  if (reload) {
    await env.view.unmount();
    await mount(env.tree());
  }
  const write = vi.spyOn(env.drive.client, "write");
  await act(async () => {
    if (reload) env.drive.uploads.enqueue(PUBLIC, [file]);
    else env.drive.uploads.retry(env.drive.uploads.tasks[0]?.id as string);
  });
  await env.settled(["conflict"]);
  expect(write).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("already exists");
  await click(button("Skip"));
});

it("invalidating a touched container refreshes open descendants without matching adjacent names", async () => {
  const env = await setup();
  const nested = `${PRIVATE}nested/`;
  const adjacent = `${DRIVE}private-other/`;
  for (const url of [nested, adjacent])
    await env.f.fetch(url, { method: "PUT", body: "", headers: { "content-type": "text/turtle" } });
  function Folder({ url }: { url: string }) {
    useFolder(url);
    return null;
  }
  await env.view.render(
    env.tree(h("div", null, h(Folder, { url: nested }), h(Folder, { url: adjacent }))),
  );
  const list = vi.spyOn(env.drive.client, "list");
  await act(async () => env.drive.invalidate(PRIVATE));
  expect(list.mock.calls.map(([url]) => url)).toEqual([nested]);
});

it("a failed folder copy refreshes its destination subtree after rollback", async () => {
  const env = await setup();
  for (const name of ["nested/a", "z"])
    await env.f.fetch(`${PRIVATE}${name}`, { method: "PUT", body: name });
  const to = `${DRIVE}Copy%20of%20private/`;
  const copying = deferred<void>();
  const fail = deferred<void>();
  env.f.intercept(async (url, init) => {
    if (url === `${to}z` && init?.method === "PUT") {
      copying.resolve();
      await fail.promise;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  let result!: Promise<string | undefined>;
  await act(async () => {
    result = env.actions.makeCopy(await env.drive.client.stat(PRIVATE));
    await copying.promise;
  });
  let listing!: ReturnType<typeof useFolder>;
  function Folder() {
    listing = useFolder(`${to}nested/`);
    return null;
  }
  await env.view.render(env.tree(h(Folder)));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(listing.status).toBe("ready");
  });
  const list = vi.spyOn(env.drive.client, "list");
  await act(async () => {
    fail.resolve();
    expect(await result).toBeUndefined();
  });
  expect((await env.f.pod.fetch(`${to}nested/`)).status).toBe(404);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(list.mock.calls.map(([url]) => url)).toContain(`${to}nested/`);
    expect(listing.status).toBe("error");
  });
});

it("a partial move failure refreshes both listings and revalidates Details and preview without notifications", async () => {
  const env = await setup();
  const from = `${PRIVATE}report.txt`;
  const target = `${DRIVE}destination/`;
  const to = `${target}report.txt`;
  await env.f.fetch(from, {
    method: "PUT",
    body: "original",
    headers: { "content-type": "text/plain" },
  });
  await env.f.fetch(target, {
    method: "PUT",
    body: "",
    headers: { "content-type": "text/turtle" },
  });
  env.f.policies.set(`${target}.policy`, await aclBody(target));
  const item = await env.drive.client.stat(from);
  const folders = new Map<string, ReturnType<typeof useFolder>>();
  let details!: ReturnType<typeof useLiveResource>;
  function Folder({ url }: { url: string }) {
    folders.set(url, useFolder(url));
    return null;
  }
  function Details() {
    details = useLiveResource(item);
    return h(PreviewBody, { item });
  }
  await env.view.render(
    env.tree(h("div", null, h(Folder, { url: PRIVATE }), h(Folder, { url: target }), h(Details))),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(folders.get(PRIVATE)?.status).toBe("ready");
    expect(folders.get(target)?.status).toBe("ready");
    expect(details.status).toBe("ready");
    expect(env.view.host.textContent).toContain("original");
  });
  const list = vi.spyOn(env.drive.client, "list");
  const stat = vi.spyOn(env.drive.client, "stat");
  env.f.intercept(async (url, init) => {
    if (url === from && init?.method === "DELETE") {
      expect((await env.f.pod.fetch(url, init)).ok).toBe(true);
      env.f.policies.delete(`${url}.policy`);
      throw new TypeError("Lost DELETE response");
    }
    return undefined;
  });
  let result: Awaited<ReturnType<typeof env.actions.move>>;
  await act(async () => {
    result = await env.actions.move([item], target);
  });
  expect(result?.done).toEqual([]);
  expect(result?.failed).toHaveLength(1);
  expect(toast.error).toHaveBeenCalledWith("Still deleting on the server", expect.anything());
  expect((await env.f.pod.fetch(from)).status).toBe(404);
  expect(await (await env.f.fetch(to)).text()).toBe("original");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(list.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([PRIVATE, target]));
    expect(stat.mock.calls.map(([url]) => url)).toContain(from);
    expect(details.status).toBe("error");
    expect(env.view.host.textContent).not.toContain("original");
    const source = folders.get(PRIVATE);
    const destination = folders.get(target);
    expect(source?.status).toBe("ready");
    expect(destination?.status).toBe("ready");
    expect(source?.status === "ready" && source.items.map((item) => item.url)).not.toContain(from);
    expect(destination?.status === "ready" && destination.items.map((item) => item.url)).toContain(
      to,
    );
  });
});
