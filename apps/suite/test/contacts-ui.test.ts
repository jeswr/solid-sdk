// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement, type ReactNode, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, click, h, key, mount } from "./drive-ui-dom";

const env = vi.hoisted(() => ({
  href: "/contacts",
  width: 1280,
  state: {} as object,
  listeners: new Set<() => void>(),
  push: (href: string) => {
    env.href = href;
    for (const listener of env.listeners) listener();
  },
}));
vi.mock("next/navigation", () => {
  const useLocation = () =>
    useSyncExternalStore(
      (listener) => {
        env.listeners.add(listener);
        return () => env.listeners.delete(listener);
      },
      () => env.href,
    );
  return {
    usePathname: () => useLocation().split("?")[0],
    useSearchParams: () => new URLSearchParams(useLocation().split("?")[1]),
    useRouter: () => ({ push: env.push }),
  };
});
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) =>
    createElement(
      "a",
      {
        ...props,
        href,
        onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            event.preventDefault();
            env.push(href);
          }
        },
      },
      children,
    ),
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => env.state,
}));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import { toast } from "@jeswr/suite-ui";
import { ContactsApp } from "../src/apps/contacts/components/contacts-app";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { seedContacts } from "../src/lib/demo-pod/seed-contacts";

beforeEach(() => {
  env.href = "/contacts";
  env.width = 1280;
  env.listeners.clear();
  localStorage.clear();
  vi.clearAllMocks();
  const media = (query: string) => ({
    matches: query.includes("min-width")
      ? env.width >= Number(/\d+/.exec(query)?.[0])
      : query.includes("max-width")
        ? env.width <= Number(/\d+/.exec(query)?.[0])
        : false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: media });
  vi.stubGlobal("matchMedia", media);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.classList.contains("suite-table-viewport") ? 620 : 36;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollTop = options.top ?? 0;
  };
});
async function settle(test: () => void) {
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    try {
      test();
      return;
    } catch (error) {
      if (i === 99) throw error;
    }
  }
}
async function setup(count = 40) {
  const files = await buildDemoSeed(1000);
  const seed =
    count === 40
      ? files
      : await seedContacts(
          files.filter((file) => !file.path.startsWith("contacts")),
          1000,
          count,
        );
  const pod = createDemoPod({ root: DEMO_ROOT, seed });
  const fetch = vi.fn(pod.fetch);
  env.state = {
    status: "ready",
    session: {
      mode: "demo",
      webId: DEMO_WEBID,
      storageUrl: DEMO_ROOT,
      displayName: "Alice",
      fetch,
      subscribe: pod.subscribe,
      reset: async () => {},
    },
  };
  const view = await mount(h(ContactsApp, null, h("p", null, "Coming next")));
  await settle(() => expect(view.host.querySelector("[data-collection-item]")).not.toBeNull());
  return { ...view, fetch };
}
function findRow(host: HTMLElement, name: string) {
  const element = [...host.querySelectorAll<HTMLElement>("[data-collection-item]")].find(
    (row) => row.getAttribute("aria-label") === name,
  );
  if (!element) throw new Error(`Missing row ${name}`);
  return element;
}
function button(host: ParentNode, text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}

describe("Contacts rendered behavior with the existing Drive DOM harness", () => {
  it("virtualises a 200-contact book and reaches its last row with End", async () => {
    const view = await setup(200);
    const rows = () => view.host.querySelectorAll("[data-collection-item]");
    expect(view.host.querySelector(".con-list-heading")?.textContent).toContain("200 contacts");
    expect(rows().length).toBeLessThan(200);
    const first = findRow(view.host, "Ada Fern");
    first.focus();
    await key(first, "End");
    await settle(() => expect(document.activeElement).toBe(findRow(view.host, "Zora Example 160")));
    expect(rows().length).toBeLessThan(200);
    await view.unmount();
  });
  it.each([
    375, 768, 1280,
  ])("opens with arrow/Enter and returns focus on Escape at %spx", async (width) => {
    env.width = width;
    const view = await setup();
    const first = findRow(view.host, "Ada Fern");
    first.focus();
    await key(first, "ArrowDown");
    const next = findRow(view.host, "Amir Vale");
    expect(document.activeElement).toBe(next);
    await key(next, "Enter");
    await settle(() =>
      expect(view.host.querySelector(".con-detail-header")?.textContent).toContain("Amir Vale"),
    );
    expect(Boolean(view.host.querySelector(".ish-details"))).toBe(width >= 1024);
    await key(document.activeElement as Element, "Escape");
    await settle(() => {
      expect(env.href).toBe("/contacts");
      expect(document.activeElement).toBe(next);
    });
    await view.unmount();
  });
  it("filters labels and highlights search while keeping search inside the current label", async () => {
    const view = await setup();
    const family = [...view.host.querySelectorAll<HTMLAnchorElement>(".con-sidebar a")].find((a) =>
      a.textContent?.includes("Family"),
    );
    await click(family as Element);
    await settle(() =>
      expect(view.host.querySelector(".con-list-heading")?.textContent).toContain("14 contacts"),
    );
    await act(async () => env.push(`${env.href}?q=Mira`));
    await settle(() => {
      expect(view.host.querySelectorAll("[data-collection-item]")).toHaveLength(1);
      expect(view.host.querySelector("mark")?.textContent).toBe("Mira");
    });
    await act(async () => env.push(`${env.href.split("?")[0]}?q=no-such-person-987`));
    await settle(() => expect(view.host.textContent).toContain("No matches"));
    await view.unmount();
  });
  it("stars, deletes and restores a contact with its labels through the real model", async () => {
    const view = await setup();
    const first = findRow(view.host, "Ada Fern");
    await click(first.querySelector('[aria-label="Star Ada Fern"]') as Element);
    expect(first.querySelector('[aria-label="Star Ada Fern"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    first.focus();
    await key(first, "Enter");
    await settle(() =>
      expect(view.host.querySelector(".con-detail-header")?.textContent).toContain("Ada Fern"),
    );
    const detail = view.host.querySelector(".con-detail") as HTMLElement;
    expect(detail.querySelector('a[href="mailto:ada.fern@example.org"]')).not.toBeNull();
    await click(button(detail, "Delete"));
    await click(
      button(document.querySelector('[role="alertdialog"]') as Element, "Delete contact"),
    );
    await settle(() =>
      expect(view.host.querySelector(".con-list-heading")?.textContent).toContain("39 contacts"),
    );
    await settle(() => expect(toast).toHaveBeenCalledWith("Contact deleted", expect.anything()));
    const options = vi.mocked(toast).mock.calls.find((call) => call[0] === "Contact deleted")?.[1];
    const undo = options?.action;
    if (!undo || typeof undo !== "object" || !("onClick" in undo))
      throw new Error("Missing Undo action");
    const undoView = await mount(h("button", { onClick: undo.onClick }, "Undo"));
    await click(button(undoView.host, "Undo"));
    await undoView.unmount();
    await settle(() => expect(findRow(view.host, "Ada Fern").textContent).toContain("Family"));
    await view.unmount();
  });
  it("migrates the PM banner candidates sequentially and never fetches external WebIDs", async () => {
    const view = await setup();
    await click(button(view.host.querySelector(".con-migration") as Element, "Move them"));
    await settle(() => {
      expect(view.host.querySelector(".con-migration")).toBeNull();
      expect(view.host.querySelector(".con-list-heading")?.textContent).toContain("42 contacts");
    });
    const bob = findRow(view.host, "Bob Meadow");
    bob.focus();
    await key(bob, "Enter");
    await settle(() =>
      expect(
        view.host.querySelector('.con-detail a[href="https://bob.demo.pod/profile/card#me"]'),
      ).not.toBeNull(),
    );
    expect(view.fetch.mock.calls.some((call) => String(call[0]).includes("bob.demo.pod"))).toBe(
      false,
    );
    await view.unmount();
  });
});
