// AUTHORED-BY Codex

import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({ ensureTypeRegistrations: vi.fn() }));
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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@jeswr/suite-ui";
import { DriveApp } from "../src/apps/drive/components/drive-app";
import { FolderView } from "../src/apps/drive/components/views";
import { DriveFocusBoundary } from "../src/apps/drive/state/app-focus";

let session: PodSession;
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
async function setup() {
  const pod = createDemoPod({ root: "https://pod.example/" });
  session = {
    mode: "demo",
    webId: "https://pod.example/profile#me",
    displayName: "Me",
    storageUrl: "https://pod.example/",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  return mount(h(DriveApp, null, h(FolderView)));
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
async function closeOverlay(overlay: Element) {
  await vi.waitFor(() => expect(overlay.contains(document.activeElement)).toBe(true));
  await key(document.activeElement as Element, "Escape");
  await vi.waitFor(() => expect(overlay.isConnected, overlay.textContent ?? "overlay").toBe(false));
}

beforeEach(() => viewport(1280));
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  375, 768, 1280,
])("c then Escape returns to Upload when New is hidden, or New on desktop (%spx)", async (width) => {
  viewport(width);
  const view = await setup();
  const upload = button("Upload", view.host);
  const newTrigger = view.host.querySelector<HTMLButtonElement>(".drv-new");
  expect(newTrigger?.getClientRects().length).toBe(width < 1024 ? 0 : 1);
  await focus(upload);
  await key(upload, "c");
  const menu = document.querySelector('[role="menu"]') as HTMLElement;
  expect(menu).not.toBeNull();
  expect(view.host.contains(menu)).toBe(false);
  expect(menu.contains(document.activeElement)).toBe(true);
  await closeOverlay(menu);
  await vi.waitFor(() => expect(document.activeElement).toBe(width < 1024 ? upload : newTrigger));
});

it.each([
  375, 768,
])("Shift+F, Shift+U and Details keep a visible return target at %spx", async (width) => {
  viewport(width);
  const view = await setup();
  const upload = button("Upload", view.host);
  await focus(upload);
  await key(upload, "F", true);
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain("New folder");
  await closeOverlay(dialog);
  await vi.waitFor(() => expect(document.activeElement).toBe(upload));

  const picker = view.host.querySelector<HTMLInputElement>('[data-testid="drive-upload-input"]');
  if (!picker) throw new Error("Missing upload picker");
  const opened = vi.spyOn(picker, "click");
  await key(upload, "U", true);
  expect(opened).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(upload);

  await key(upload, "]");
  const details = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(details.textContent).toContain("Details");
  await click(button("Close details", details));
  await vi.waitFor(() => expect(details.isConnected).toBe(false));
  await vi.waitFor(() => expect(document.activeElement).toBe(upload));
});

function Overlay({ kind }: { kind: "menu" | "popover" }) {
  const [open, setOpen] = useState(false);
  const Root = kind === "menu" ? DropdownMenu : Popover;
  const Trigger = kind === "menu" ? DropdownMenuTrigger : PopoverTrigger;
  const content =
    kind === "menu"
      ? h(DropdownMenuContent, null, h(DropdownMenuItem, null, "Menu action"))
      : h(PopoverContent, null, h("button", null, "Popover action"));
  return h(
    DriveFocusBoundary,
    null,
    h(
      "main",
      { tabIndex: -1 },
      h("div", null, h("button", { onClick: () => setOpen(true) }, "Open overlay")),
      h("div", null, h("div", { "data-drive-listing": "", tabIndex: -1 })),
      h(
        Root,
        { open, onOpenChange: setOpen },
        h("div", { "data-return-parent": "" }, h(Trigger, null, "Return target")),
        content,
      ),
    ),
  );
}

const unusable = [
  "disconnected",
  "no layout box",
  "hidden subtree",
  "invisible subtree",
  "inert subtree",
] as const;
function makeUnusable(element: HTMLElement, reason: (typeof unusable)[number]) {
  if (reason === "disconnected") element.remove();
  else if (reason === "no layout box") element.style.display = "contents";
  else if (reason === "hidden subtree") element.parentElement?.setAttribute("hidden", "");
  else if (reason === "invisible subtree" && element.parentElement)
    element.parentElement.style.visibility = "hidden";
  else element.parentElement?.setAttribute("inert", "");
}

it.each(
  (["menu", "popover"] as const).flatMap((kind) => unusable.map((reason) => ({ kind, reason }))),
)("portalled $kind returns to its pre-open control with a $reason return target", async ({
  kind,
  reason,
}) => {
  const view = await mount(h(Overlay, { kind }));
  const opener = button("Open overlay", view.host);
  await focus(opener);
  await click(opener);
  const overlay = document.querySelector(
    '[role="menu"], [data-slot="popover-content"]',
  ) as HTMLElement;
  expect(overlay.contains(document.activeElement)).toBe(true);
  expect(view.host.contains(overlay)).toBe(false);
  await act(async () => makeUnusable(button("Return target", view.host), reason));
  await closeOverlay(overlay);
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

it.each(
  (["listing", "main"] as const).flatMap((destination) =>
    unusable.map((reason) => ({ destination, reason })),
  ),
)("portalled menu falls back to $destination with a $reason pre-open control", async ({
  destination,
  reason,
}) => {
  const view = await mount(h(Overlay, { kind: "menu" }));
  const opener = button("Open overlay", view.host);
  await focus(opener);
  await click(opener);
  const menu = document.querySelector('[role="menu"]') as HTMLElement;
  await act(async () => {
    makeUnusable(button("Return target", view.host), "hidden subtree");
    makeUnusable(opener, reason);
    if (destination === "main")
      makeUnusable(view.host.querySelector("[data-drive-listing]") as HTMLElement, reason);
  });
  await closeOverlay(menu);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      view.host.querySelector(destination === "listing" ? "[data-drive-listing]" : "main"),
    ),
  );
});

it.each([
  "menu",
  "popover",
] as const)("portalled %s preserves its visible return trigger", async (kind) => {
  const view = await mount(h(Overlay, { kind }));
  const opener = button("Open overlay", view.host);
  const trigger = button("Return target", view.host);
  await focus(opener);
  await click(opener);
  await closeOverlay(
    document.querySelector('[role="menu"], [data-slot="popover-content"]') as HTMLElement,
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("closing a portalled popover preserves a deliberate focus move outside Drive", async () => {
  const view = await mount(h(Overlay, { kind: "popover" }));
  const opener = button("Open overlay", view.host);
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    await focus(opener);
    await click(opener);
    const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement;
    await focus(outside);
    await vi.waitFor(() => expect(popover.isConnected).toBe(false));
    expect(document.activeElement).toBe(outside);
    await act(async () => {
      outside.remove();
      opener.append(" updated");
    });
    expect(document.activeElement).toBe(document.body);
  } finally {
    outside.remove();
  }
});
