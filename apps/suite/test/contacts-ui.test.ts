// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement, type ReactNode, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, click, h, key, mount } from "./drive-ui-dom";

const env = vi.hoisted(() => ({
  href: "/contacts",
  width: 1280,
  state: {} as object,
  listeners: new Set<() => void>(),
  refresh: async () => {},
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
import { ContactEditor } from "../src/apps/contacts/components/contact-form";
import { ContactImport } from "../src/apps/contacts/components/contact-import";
import { ContactsApp } from "../src/apps/contacts/components/contacts-app";
import { ContactsModel } from "../src/apps/contacts/lib/model/book";
import { useAddressBook } from "../src/apps/contacts/state/contacts-context";
import { decodeContactRef } from "../src/apps/contacts/state/data";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { seedContacts } from "../src/lib/demo-pod/seed-contacts";

beforeEach(() => {
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  vi.stubGlobal("HTMLOptionElement", window.HTMLOptionElement);
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
function ContactRoute() {
  env.refresh = useAddressBook().retry;
  const href = useSyncExternalStore(
    (listener) => {
      env.listeners.add(listener);
      return () => {
        env.listeners.delete(listener);
      };
    },
    () => env.href,
  ).split("?")[0];
  if (href === "/contacts/new") return h(ContactEditor);
  if (href === "/contacts/import") return h(ContactImport);
  const edit = /^\/contacts\/c\/([^/]+)\/edit$/.exec(href ?? "");
  return edit ? h(ContactEditor, { contactRef: edit[1] as string }) : null;
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
  const view = await mount(h(ContactsApp, null, h(ContactRoute)));
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
  it("keeps Contacts usable and shows a persistent recovery warning when the localStorage getter throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    ) as PropertyDescriptor;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
    try {
      const view = await setup();
      expect(view.host.querySelector(".con-list-heading")?.textContent).toContain("40 contacts");
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("recovery will be lost on reload"),
        { duration: Infinity },
      );
      await view.unmount();
    } finally {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });
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
    const input = view.host.querySelector<HTMLInputElement>('[role="combobox"]');
    if (!input) throw new Error("Missing Labels input");
    await act(async () => input.focus());
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await key(input, "Escape");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(env.href).toContain("/contacts/c/");
    expect(document.activeElement).toBe(input);
    await key(document.activeElement as Element, "Escape");
    await settle(() => {
      expect(env.href).toBe("/contacts");
      expect(document.activeElement).toBe(next);
    });
    await view.unmount();
  });
  it.each([
    375, 1280,
  ])("restores focus to the empty-state action after unstarring the only rendered contact at %spx", async (width) => {
    env.width = width;
    const view = await setup();
    await click(
      findRow(view.host, "Ada Fern").querySelector('[aria-label="Star Ada Fern"]') as Element,
    );
    await act(async () => env.push("/contacts/starred"));
    await settle(() =>
      expect(view.host.querySelectorAll("[data-collection-item]")).toHaveLength(1),
    );
    await key(findRow(view.host, "Ada Fern"), "Enter");
    await settle(() => expect(view.host.querySelector(".con-detail")).not.toBeNull());
    await click(view.host.querySelector('.con-detail [aria-label="Star Ada Fern"]') as Element);
    await click(button(view.host.querySelector(".con-detail") as Element, "Back to contacts"));
    await settle(() => {
      expect(env.href).toBe("/contacts/starred");
      expect(view.host.querySelectorAll("[data-collection-item]")).toHaveLength(0);
      expect(document.activeElement).toBe(
        view.host.querySelector('.con-list a[href="/contacts/new"]'),
      );
    });
    await view.unmount();
  });
  it.each([375, 1280])("creates and edits contacts through the form at %spx", async (width) => {
    env.width = width;
    const view = await setup();
    await act(async () => env.push("/contacts/new"));
    const form = () => document.querySelector(".con-form") as HTMLFormElement;
    const field = (name: string) =>
      form().querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
    await fill(field("name"), "Lane Person");
    await fill(field("emails.0.value"), "lane@example.org");
    await click(button(form(), "Add email"));
    await fill(field("emails.1.value"), "lane.work@example.org");
    await fill(field("phones.0.value"), "+1 (202) 555-0193");
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle(() =>
      expect(view.host.querySelector(".con-detail-header")?.textContent).toContain("Lane Person"),
    );
    await settle(() => expect(view.host.querySelector(".con-save")?.textContent).toBe(""));
    expect(
      view.host.querySelector('.con-detail a[href="mailto:lane.work@example.org"]'),
    ).not.toBeNull();
    expect(view.host.querySelector('.con-detail a[href="tel:+12025550193"]')).not.toBeNull();
    await click(view.host.querySelector('.con-detail a[href$="/edit"]') as Element);
    await fill(field("name"), "Edited Lane Person");
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle(() =>
      expect(view.host.querySelector(".con-detail-header")?.textContent).toContain(
        "Edited Lane Person",
      ),
    );
    await settle(() => expect(view.host.querySelector(".con-save")?.textContent).toBe(""));
    await view.unmount();
  });
  it("updates only locally edited fields after a refreshed remote change", async () => {
    env.width = 375;
    const view = await setup();
    await key(findRow(view.host, "Ada Fern"), "Enter");
    await settle(() => expect(view.host.querySelector(".con-detail")).not.toBeNull());
    await click(view.host.querySelector('.con-detail a[href$="/edit"]') as Element);
    const form = view.host.querySelector(".con-form") as HTMLFormElement;
    await fill(form.querySelector('[name="name"]') as HTMLInputElement, "Ada Edited");
    const model = new ContactsModel(view.fetch, DEMO_ROOT);
    const book = await model.loadAddressBook();
    const ref = env.href.split("/")[3] as string;
    const person = await model.loadContact(decodeContactRef(book.url, ref));
    await act(async () => {
      await model.updateContact(book, person, {
        ...person.data,
        organization: "Changed elsewhere",
      });
    });
    // Refresh through the real controller while the draft retains its original inputs.
    await act(async () => {
      await env.refresh();
    });
    expect((form.querySelector('[name="organization"]') as HTMLInputElement).value).toBe(
      "Fictional Observatory",
    );
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle(() =>
      expect(view.host.querySelector(".con-detail-header")?.textContent).toContain(
        "Changed elsewhere",
      ),
    );
    await settle(() => expect(view.host.querySelector(".con-save")?.textContent).toBe(""));
    const saved = await model.loadContact(person.url);
    expect(saved.data).toMatchObject({ name: "Ada Edited", organization: "Changed elsewhere" });
    await view.unmount();
  });
  it("announces validation and focuses the first invalid field, then confirms dirty cancellation", async () => {
    env.width = 375;
    const view = await setup();
    await act(async () => env.push("/contacts/new"));
    const form = view.host.querySelector(".con-form") as HTMLFormElement;
    await fill(form.querySelector('[name="name"]') as HTMLInputElement, "Draft");
    const email = form.querySelector('[name="emails.0.value"]') as HTMLInputElement;
    await fill(email, "broken");
    await fill(form.querySelector('[name="webId"]') as HTMLInputElement, "http://example.org/me");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle(() => {
      expect(form.querySelector(".con-form-summary")?.textContent).toBe("2 fields need attention");
      expect(document.activeElement).toBe(email);
      expect(form.querySelectorAll('[role="alert"]')).toHaveLength(2);
    });
    await fill(email, "mira.quill@example.org");
    expect(form.textContent).toContain("Mira Quill already uses this email");
    await click(button(form, "Cancel"));
    const dialog = document.querySelector('[role="alertdialog"]') as Element;
    expect(dialog.textContent).toContain("Discard changes?");
    await click(button(dialog, "Keep editing"));
    expect(env.href).toBe("/contacts/new");
    await click(button(form, "Cancel"));
    await click(
      button(document.querySelector('[role="alertdialog"]') as Element, "Discard changes"),
    );
    await settle(() => expect(env.href).toBe("/contacts"));
    await view.unmount();
  });
  it("previews vCards, excludes the existing email, and imports only selected rows", async () => {
    const view = await setup();
    await act(async () => env.push("/contacts/import"));
    const picker = view.host.querySelector('[aria-label="Choose files"]') as HTMLInputElement;
    const file = new File(
      [
        "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Copy\r\nEMAIL:mira.quill@example.org\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:4.0\r\nFN:Imported Person\r\nEMAIL:imported@example.org\r\nEND:VCARD\r\n",
      ],
      "contacts.vcf",
    );
    Object.defineProperty(picker, "files", { configurable: true, value: [file] });
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(() =>
      expect(view.host.querySelector(".con-wizard h2")?.textContent).toBe("Preview contacts"),
    );
    expect(
      view.host.querySelector('[aria-label="Include Copy"]')?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(view.host.querySelector(".con-wizard")?.textContent).toContain(
      "Possible duplicate: Mira Quill",
    );
    await click(button(view.host, "Import 1 contacts"));
    await settle(() =>
      expect(view.host.querySelector(".con-wizard")?.textContent).toContain(
        "1 contacts imported. 0 failed.",
      ),
    );
    await click(view.host.querySelector('.con-wizard a[href*="created="]') as Element);
    await settle(() => expect(findRow(view.host, "Imported Person")).not.toBeNull());
    expect(view.host.querySelectorAll("[data-collection-item]")).toHaveLength(1);
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
  it.each([
    "unknown",
    "Z3JvdXBzL3JlbW92ZWQudHRs",
  ])("shows an unknown label (%s) with a link back to All contacts", async (ref) => {
    const view = await setup();
    await act(async () => env.push(`/contacts/label/${ref}`));
    await settle(() => expect(view.host.querySelector("h1")?.textContent).toBe("Label not found"));
    expect(view.host.textContent).not.toContain("No matches");
    const back = view.host.querySelector<HTMLAnchorElement>('.con-list a[href="/contacts"]');
    expect(back?.textContent).toBe("All contacts");
    await click(back as Element);
    await settle(() => expect(view.host.querySelector("h1")?.textContent).toBe("All contacts"));
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
    await settle(() =>
      expect(toast).toHaveBeenCalledWith("Contact moved to Trash", expect.anything()),
    );
    const options = vi
      .mocked(toast)
      .mock.calls.find((call) => call[0] === "Contact moved to Trash")?.[1];
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
