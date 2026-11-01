// AUTHORED-BY Codex

import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

import { toast } from "@jeswr/suite-ui";
import { DriveApp } from "../src/apps/drive/components/drive-app";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveActions } from "../src/apps/drive/state/ui";
import { rdfPod } from "./drive-rdf-pod";
import { DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let actions: ReturnType<typeof useDriveActions>;
function Probe() {
  drive = useDrive();
  actions = useDriveActions();
  return h("div", { "data-drive-listing": "", tabIndex: -1 }, "Listing");
}
const nativeFocus = HTMLElement.prototype.focus;

function noLayout(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || style.display === "none") return true;
  }
  return false;
}
function viewport(width: number) {
  vi.spyOn(window, "matchMedia").mockImplementation((media) => {
    const max = /max-width:\s*(\d+)/.exec(media);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    };
  });
  // jsdom has no layout or responsive CSS. Model the existing shell/FAB breakpoints
  // and the browser refusing focus on controls without a usable layout box.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    const absent =
      !this.isConnected ||
      noLayout(this) ||
      getComputedStyle(this).display === "contents" ||
      (width < 1024 && Boolean(this.closest(".ish-sidebar"))) ||
      (width >= 768 && Boolean(this.closest(".drv-fab-slot")));
    const rects = absent ? [] : [new DOMRect(0, 0, 100, 30)];
    return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
  });
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    if (
      this.getClientRects().length > 0 &&
      !this.closest("[inert]") &&
      !["hidden", "collapse"].includes(getComputedStyle(this).visibility)
    )
      nativeFocus.call(this, options);
  });
}
function button(label: string, scope: ParentNode = document) {
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

async function setup() {
  const f = await rdfPod();
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const view = await mount(h(DriveApp, null, h(Probe)));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
  });
  return { f, view };
}
beforeEach(() => viewport(1280));
afterEach(async () => {
  await act(async () => toast.dismiss());
  vi.restoreAllMocks();
  localStorage.clear();
});

it("round 63: keyboard Trash Undo returns focus when its toast action disappears", async () => {
  const { f, view } = await setup();
  const source = `${PRIVATE}secret`;
  await act(async () => actions.trash([await drive.client.stat(source)]));
  await vi.waitFor(() => expect(button("Undo")).toBeDefined());
  const undo = button("Undo");
  await focus(undo);
  await key(undo, "Enter");
  await click(undo);
  await vi.waitFor(() => expect(document.body.textContent).toContain("Restored secret"));
  await vi.waitFor(() => expect(undo.isConnected).toBe(false));
  expect(f.pod.has(source)).toBe(true);
  expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(view.host.querySelector("[data-drive-listing]")),
  );
});

it("round 63: cancelling New folder inside Navigation restores focus within the surviving modal", async () => {
  viewport(768);
  await setup();
  await click(button("Open navigation"));
  const drawer = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!drawer) throw new Error("Missing Navigation drawer");
  await focus(button("New", drawer));
  await key(button("New", drawer), "Enter");
  const menu = document.activeElement?.closest('[role="menu"]');
  const menuItem = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
    (node) => node.textContent?.includes("New folder"),
  );
  if (!menuItem) throw new Error("Missing New folder");
  await focus(menuItem);
  await click(menuItem);
  const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
    (node) => node.textContent?.includes("New folder") && node !== drawer,
  );
  if (!dialog) throw new Error("Missing New folder dialog");
  await click(button("Cancel", dialog));
  await vi.waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(drawer.isConnected).toBe(true);
  await vi.waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
  expect(document.activeElement?.closest('[aria-hidden="true"], [inert]')).toBeNull();
});
