// AUTHORED-BY Codex

import { useState } from "react";
import { expect, it, vi } from "vitest";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({
  usePathname: () => "/drive/my",
  useRouter: () => ({ push: vi.fn() }),
}));

import { SuiteFrame } from "../src/components/interim-shell/suite-frame";

function viewport(width: number) {
  const queries = new Map<string, Set<() => void>>();
  let current = width;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      get matches() {
        const max = /max-width:\s*(\d+)/.exec(media);
        return max ? current <= Number(max[1]) : false;
      },
      addEventListener: (_: string, listener: () => void) => {
        const set = queries.get(media) ?? new Set();
        set.add(listener);
        queries.set(media, set);
      },
      removeEventListener: (_: string, listener: () => void) =>
        queries.get(media)?.delete(listener),
    }),
  });
  return async (next: number) => {
    current = next;
    await act(async () => {
      for (const listeners of queries.values()) for (const listener of listeners) listener();
    });
  };
}
function Frame() {
  const [open, setOpen] = useState(false);
  return h(SuiteFrame, {
    app: "drive",
    sidebar: h("p", null, "Navigation"),
    actions: h("button", { onClick: () => setOpen(!open) }, "Details"),
    details: open ? h("div", null, "Report.pdf details") : undefined,
    onDetailsClose: () => setOpen(false),
    children: h("p", null, "Files"),
  });
}
it.each([375, 768])("exposes Details in a dismissible Sheet at %spx", async (width) => {
  viewport(width);
  const view = await mount(h(Frame));
  const trigger = [...view.host.querySelectorAll("button")].find(
    (e) => e.textContent === "Details",
  ) as HTMLButtonElement;
  trigger.focus();
  await click(trigger);
  const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(sheet).not.toBeNull();
  expect(sheet?.textContent).toContain("Report.pdf details");
  expect(sheet?.getAttribute("aria-labelledby")).toBeTruthy();
  expect(sheet?.classList.contains(width < 640 ? "bottom-0" : "right-0")).toBe(true);
  expect(view.host.querySelector(".ish-details")).toBeNull();
  await key(sheet as Element, "Escape");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement === trigger).toBe(true);
  await view.unmount();
});
it("moves open Details between the desktop pane and narrow Sheet on resize", async () => {
  const resize = viewport(1280);
  const view = await mount(h(Frame));
  await click(
    [...view.host.querySelectorAll("button")].find((e) => e.textContent === "Details") as Element,
  );
  expect(view.host.querySelector(".ish-details")?.textContent).toContain("Report.pdf details");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await resize(768);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Report.pdf details");
  await resize(1280);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(view.host.querySelector(".ish-details")?.textContent).toContain("Report.pdf details");
  await view.unmount();
});

it("returns navigation drawer focus to Open navigation on Close", async () => {
  viewport(375);
  const view = await mount(h(Frame));
  const trigger = view.host.querySelector<HTMLElement>(
    '[aria-label="Open navigation"]',
  ) as HTMLElement;
  trigger.focus();
  await click(trigger);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const dialog = document.querySelector('[role="dialog"]') as Element;
  await click(dialog.querySelector('[aria-label="Close"]') as Element);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement === trigger).toBe(true);
  await view.unmount();
});
