// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams({ q: "secret" }),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DetailsPane } from "../src/apps/drive/components/details";
import { DriveApp } from "../src/apps/drive/components/drive-app";
import { listTrash, trashItems } from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveActions } from "../src/apps/drive/state/ui";

let change: (url: string) => void;
let actions: ReturnType<typeof useDriveActions>;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  actions = useDriveActions();
  return null;
}
function tree(body: ReactNode) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup() {
  const f = await rdfPod();
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: (listener) => {
      change = listener;
      return () => {};
    },
    reset: vi.fn(),
  };
  const view = await mount(tree(null));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
    expect(view.host.querySelector(".drv-usage")?.textContent).toMatch(/used$/);
  });
  return { f, view };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});

it("round 55: UI partial Restore preserves approved recovery root and source guards", async () => {
  const { f } = await setup();
  const source = `${PRIVATE}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "public original" });
  f.policies.set(`${source}.policy`, await aclBody(source, true));
  f.intercept(async (url, init) =>
    url === `${source}child` && init?.method === "DELETE"
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await trashItems(drive.client, DRIVE, [await drive.client.stat(source)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  let replaced = false;
  f.after(async (url, method, response) => {
    if (!replaced && url === entry.url && method === "GET" && response.ok) {
      replaced = true;
      await f.pod.fetch(`${entry.url}child`, { method: "DELETE" });
      await f.pod.fetch(entry.url, { method: "DELETE" });
      await f.pod.fetch(`${entry.url}child`, { method: "PUT", body: "replacement secret" });
    }
    return response;
  });
  await act(async () => actions.restore([entry]));
  expect(replaced).toBe(true);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(await (await f.pod.fetch(`${source}child`)).text()).toBe("public original");
  const { toast } = await import("@jeswr/suite-ui");
  expect(toast.error).toHaveBeenCalled();
});
it("round 55: ancestor ACL events refresh descendant Details sharing labels", async () => {
  const { f, view } = await setup();
  const url = `${PRIVATE}nested/secret.txt`;
  await f.pod.fetch(url, { method: "PUT", body: "secret contents" });
  await view.render(
    tree(h(DetailsPane, { items: [await drive.client.stat(url)], onClose: vi.fn() })),
  );
  await vi.waitFor(() => expect(view.host.textContent).toContain("Only you"));
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  await act(async () => change(`${PRIVATE}.policy`));
  await vi.waitFor(() => expect(view.host.textContent).toContain("Anyone with the link"));
  expect((await f.anonymous(url)).status).toBe(200);
});

it("round 55: refresh wrappers forward every copy and merge option unchanged", async () => {
  await setup();
  const operations = await import("../src/apps/drive/lib/operations/operations");
  const copy = vi.spyOn(drive.client, "copy").mockResolvedValue();
  const merge = vi
    .spyOn(drive.client, "mergeContainer")
    .mockResolvedValue({ recheck: async () => {}, disarm: [] });
  const guards = [{ url: `${PRIVATE}tree/`, etag: '"approved ancestor"' }];
  const options = { ifMatch: '"approved root"', sourceGuards: guards };
  vi.spyOn(operations, "restoreItems").mockImplementation(async (tracked) => {
    await tracked.copy(`${PRIVATE}from`, `${PRIVATE}to`, { kind: "preserve-source" }, options);
    await tracked.mergeContainer(
      `${PRIVATE}from/`,
      `${PRIVATE}to/`,
      { kind: "preserve-source" },
      options,
    );
    return { done: [], failed: [] };
  });
  await act(async () => actions.restore([]));
  expect(copy.mock.calls[0]?.[3]).toBe(options);
  expect(merge.mock.calls[0]?.[3]).toBe(options);
});
