// AUTHORED-BY Codex

import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
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
import { FolderView } from "../src/apps/drive/components/views";
import { useDrive } from "../src/apps/drive/state/drive-context";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}
async function setup(body: ReactNode = h(FolderView)) {
  const pod = createDemoPod({ root: STORAGE });
  session = {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  return mount(h(DriveApp, null, h(Probe), body));
}
function button(label: string, scope: ParentNode) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
  expect(document.activeElement).toBe(element);
}
async function activate(element: HTMLElement) {
  await focus(element);
  await key(element, "Enter");
  // jsdom does not synthesize the native button click from Enter.
  await click(element);
}
function arbitraryControl() {
  return h("button", { type: "button" }, "Temporary control");
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("empty My Drive Upload restores listing focus after the first file completes", async () => {
  const view = await setup();
  const upload = button("Upload", view.host.querySelector(".drv-state-actions") as HTMLElement);
  const picker = view.host.querySelector<HTMLInputElement>('[data-testid="drive-upload-input"]');
  if (!picker) throw new Error("Missing upload picker");
  const opened = vi.spyOn(picker, "click");
  await activate(upload);
  expect(opened).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(upload);
  await act(async () => {
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File(["first file"], "First.txt", { type: "text/plain" })],
    });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("done");
    expect(view.host.querySelector("[data-url]")?.textContent).toContain("First.txt");
  });
  expect(upload.isConnected).toBe(false);
  expect(document.activeElement).toBe(view.host.querySelector("[data-drive-listing]"));
});

it("folder-listing Retry restores listing focus when the listing returns", async () => {
  const view = await setup();
  const listing = vi.spyOn(drive.client, "list").mockRejectedValue(new Error("offline"));
  await act(async () => drive.invalidate(ROOT));
  const retry = button("Retry", view.host);
  listing.mockRestore();
  await activate(retry);
  await vi.waitFor(() => expect(retry.isConnected).toBe(false));
  expect(view.host.querySelector(".drv-state")?.textContent).toContain("Your Drive is empty");
  expect(document.activeElement).toBe(view.host.querySelector("[data-drive-listing]"));
});

it.each([
  "listing",
  "preview",
  "main",
] as const)("removing an arbitrary focused control restores focus to the %s fallback", async (destination) => {
  const view = await setup([
    destination === "listing"
      ? h(FolderView, { key: "listing" })
      : destination === "preview"
        ? h("section", { key: "preview", "data-drive-preview": "", tabIndex: -1 })
        : null,
    h("div", { key: "control" }, arbitraryControl()),
  ]);
  const control = button("Temporary control", view.host);
  await focus(control);
  // Bypass React entirely: recovery must cover any DOM removal inside Drive.
  await act(async () => control.parentElement?.remove());
  expect(control.isConnected).toBe(false);
  expect(document.activeElement).toBe(
    view.host.querySelector(
      destination === "listing"
        ? "[data-drive-listing]"
        : destination === "preview"
          ? "[data-drive-preview]"
          : "main",
    ),
  );
});

it.each([
  false,
  true,
])("removal preserves focus moved outside Drive (outside removed: %s)", async (removed) => {
  const view = await setup(h("div", null, h(FolderView), arbitraryControl()));
  const control = button("Temporary control", view.host);
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    await focus(control);
    await focus(outside);
    await act(async () => {
      if (removed) outside.remove();
      control.remove();
    });
    expect(document.activeElement).toBe(removed ? document.body : outside);
  } finally {
    outside.remove();
  }
});

it("an unrelated mutation after a deliberate blur does not move focus", async () => {
  const view = await setup(h("div", null, h(FolderView), arbitraryControl()));
  const control = button("Temporary control", view.host);
  await focus(control);
  await act(async () => {
    control.blur();
    control.append("updated");
  });
  expect(control.isConnected).toBe(true);
  expect(document.activeElement).toBe(document.body);
});

it.each([
  "before autofocus",
  "in a portal",
  "inside Drive",
])("removals while a modal owns focus %s do not recover into the background listing", async (location) => {
  const view = await setup(h("div", null, h(FolderView), arbitraryControl()));
  const control = button("Temporary control", view.host);
  await focus(control);
  // Modal focus can temporarily fall back to body while its controls are replaced.
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const modalControl = document.createElement("button");
  modal.append(modalControl);
  (location === "inside Drive" ? view.host.querySelector("main") : document.body)?.append(modal);
  try {
    if (location !== "before autofocus") await focus(modalControl);
    await act(async () => {
      modalControl.remove();
      control.remove();
    });
    expect(document.activeElement).toBe(document.body);
  } finally {
    modal.remove();
  }
});
