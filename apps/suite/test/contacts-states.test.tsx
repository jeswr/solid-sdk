// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, h, mount } from "./drive-ui-dom";

const env = vi.hoisted(() => ({
  params: "",
  status: "ready",
  book: true,
  retry: vi.fn(),
  createAddressBook: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(env.params),
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/apps/contacts/state/contacts-context", () => ({
  useContacts: () => ({
    status: env.status,
    book: env.book ? { url: "https://pod.example/contacts/book.ttl" } : null,
    data: { people: [], groups: [], incomplete: false },
    contacts: [],
    labels: () => [],
    retry: env.retry,
    createAddressBook: env.createAddressBook,
  }),
  useStarred: () => ({ stars: new Set(), toggle: vi.fn() }),
}));

import { ContactsList } from "../src/apps/contacts/components/contacts-list";

const list = (path = "/contacts") => h(ContactsList, { path, onOpen: vi.fn() });
beforeEach(() => {
  env.params = "";
  env.status = "ready";
  env.book = true;
  vi.clearAllMocks();
});

describe("Contacts empty and error states", () => {
  it("explains first use with a decorative people icon and New contact and Import actions", async () => {
    const { host } = await mount(list());
    const empty = host.querySelector('.suite-async-state[role="status"]');
    expect(empty?.querySelector("h3")?.textContent).toBe("No contacts yet");
    expect(empty?.querySelector("p")?.textContent).toBe(
      "Keep contact details together in your pod. Add a contact or import a vCard file.",
    );
    expect(empty?.querySelector('.suite-async-tile[aria-hidden="true"] svg')).not.toBeNull();
    const actions = empty?.querySelectorAll("a") ?? [];
    expect([...actions].map((action) => action.textContent)).toEqual(["New contact", "Import"]);
    expect(actions?.[0]?.getAttribute("href")).toBe("/contacts/new");
    expect(actions?.[0]?.getAttribute("data-variant")).toBe("default");
    expect(actions?.[1]?.getAttribute("href")).toBe("/contacts/import");
    expect(actions?.[1]?.getAttribute("data-variant")).toBe("outline");
    expect(host.querySelector("table")).toBeNull();
  });

  it("explains an empty search and clears only the query, keeping the current view and filters", async () => {
    env.params = "q=nobody&created=one,two";
    const { host } = await mount(list("/contacts/starred"));
    expect(host.querySelector("h3")?.textContent).toBe("No matches");
    expect(host.querySelector(".suite-async-state p")?.textContent).toBe(
      "Try another search or label.",
    );
    expect(host.querySelector(".con-list-heading [role='status']")?.textContent).toBe(
      "0 contacts matching “nobody”",
    );
    const clear = host.querySelector(".suite-async-actions a");
    expect(clear?.textContent).toBe("Clear search");
    expect(clear?.getAttribute("href")).toBe("/contacts/starred?created=one%2Ctwo");
    expect(host.textContent).not.toContain("No contacts yet");
    expect(host.querySelector('a[href="/contacts/import"]')).toBeNull();
  });

  it("keeps the first-run actions out of an empty Starred view", async () => {
    const { host } = await mount(list("/contacts/starred"));
    expect(host.querySelector("h3")?.textContent).toBe("No matches");
    expect(host.textContent).toContain("Star a contact to find them here.");
    expect(host.querySelector('a[href="/contacts/new"]')).not.toBeNull();
    expect(host.querySelector('a[href="/contacts/import"]')).toBeNull();
  });

  it("offers address-book setup before first use when no book exists", async () => {
    env.book = false;
    const { host } = await mount(list());
    expect(host.querySelector("h3")?.textContent).toBe("Create your address book");
    await click(host.querySelector("button") as HTMLButtonElement);
    expect(env.createAddressBook).toHaveBeenCalledOnce();
  });

  it("announces a load failure in plain English and retries without presenting an empty book", async () => {
    env.status = "error";
    env.book = false;
    const { host } = await mount(list());
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.querySelector("h3")?.textContent).toBe("Can't reach your storage");
    expect(alert?.querySelector("p")?.textContent).toBe(
      "We couldn't load your contacts. Check your connection and try again.",
    );
    expect(host.textContent).not.toContain("Create your address book");
    expect(host.textContent).not.toContain("No contacts yet");
    const retry = alert?.querySelector("button");
    expect(retry?.textContent).toBe("Retry");
    await click(retry as HTMLButtonElement);
    expect(env.retry).toHaveBeenCalledOnce();
  });

  it("shows loading instead of an empty state while contacts are being fetched", async () => {
    env.status = "loading";
    env.book = false;
    const { host } = await mount(list());
    expect(host.querySelector('[aria-label="Loading contacts"]')).not.toBeNull();
    expect(host.querySelector(".suite-async-state")).toBeNull();
  });
});
