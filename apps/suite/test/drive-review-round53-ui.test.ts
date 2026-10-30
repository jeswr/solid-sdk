// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

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

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { TrashView } from "../src/apps/drive/components/views";
import { listTrash } from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveActions } from "../src/apps/drive/state/ui";

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
  const f = await wacPod();
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
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

it.each([
  "toast",
  "confirmation",
])("round 53: Delete forever keeps the selected identity while the %s is open", async (timing) => {
  const { f } = await setup();
  const source = `${PRIVATE}secret`;
  const selected = await drive.client.stat(source);
  const { toast } = await import("@jeswr/suite-ui");
  f.intercept(async (url) => (url.endsWith(".policy") ? new Response("invalid RDF") : undefined));
  await act(async () => actions.trash([selected]));
  const options = vi.mocked(toast.error).mock.calls.at(-1)?.[1] as
    | { action: { label: string; onClick(): void } }
    | undefined;
  if (!options?.action) throw new Error("Missing Delete forever action");
  if (timing === "toast") await f.pod.fetch(source, { method: "PUT", body: "replacement" });
  await act(async () => options.action?.onClick());
  if (timing === "confirmation") await f.pod.fetch(source, { method: "PUT", body: "replacement" });
  const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (button) => button.textContent === "Delete for ever",
  );
  if (!confirm) throw new Error("Missing confirmation");
  await click(confirm);
  expect(await (await f.pod.fetch(source)).text()).toBe("replacement");
  expect(f.calls).not.toContainEqual({ url: source, method: "DELETE" });
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed|conflict/i));
});

it.each([
  "Delete for ever",
  "Empty trash",
])("round 53: %s confirmation carries the displayed recovery validator", async (label) => {
  const { f, view } = await setup();
  await act(async () => actions.trash([await drive.client.stat(`${PRIVATE}secret`)]));
  const [entry] = await listTrash(drive.client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  await view.render(tree(h(TrashView)));
  let open: Element | undefined;
  await vi.waitFor(() => {
    open =
      label === "Empty trash"
        ? [...view.host.querySelectorAll("button")].find((button) => button.textContent === label)
        : (view.host.querySelector(`[aria-label="Delete for ever: ${entry.name}"]`) ?? undefined);
    expect(open).toBeDefined();
  });
  if (!open) throw new Error("Missing deletion action");
  await click(open);
  await f.pod.fetch(entry.url, { method: "PUT", body: "replacement" });
  const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (button) => button.textContent === label,
  );
  if (!confirm) throw new Error("Missing confirmation");
  f.calls.length = 0;
  await click(confirm);
  expect(await (await f.pod.fetch(entry.url)).text()).toBe("replacement");
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
  expect(await listTrash(drive.client, DRIVE)).toHaveLength(1);
});
