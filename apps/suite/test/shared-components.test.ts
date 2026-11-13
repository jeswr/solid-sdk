// AUTHORED-BY Codex GPT-6.1-Sol
import { type SharedItem, sharedAccountKey } from "@jeswr/suite-sdk/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, h, mount } from "./drive-ui-dom";

const state = vi.hoisted(() => ({
  items: [] as SharedItem[],
  storageUrl: "https://bob.example/",
  loading: false,
  error: false,
  remove: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("app=docs") }));
vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => ({ webId: "alice" }),
}));
vi.mock("../src/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: string }) => h("h1", {}, children),
}));
vi.mock("../src/lib/shared/use-shared-items", () => ({ useSharedItems: () => state }));

import { useHiddenSharedItems } from "../src/lib/shared/hidden";
import { SharedCard } from "../src/lib/shared/shared-card";
import { SharedPage } from "../src/lib/shared/shared-page";

beforeEach(() => {
  localStorage.clear();
  state.loading = false;
  state.error = false;
  state.remove.mockReset();
  state.items = Array.from(
    { length: 6 },
    (_, i): SharedItem => ({
      url: `https://bob.example/docs/${i}.ttl`,
      name: `Plan ${i}`,
      app: i === 5 ? "sheets" : "docs",
      kind: "document",
      sharedBy: "https://bob.example/#me",
      sharedAt: "2026-11-01T12:00:00Z",
      role: "Editor",
      source: "inbox",
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

it("Home shows the latest five with real links and the shared page filters and removes", async () => {
  const card = await mount(h(SharedCard));
  expect(card.host.querySelectorAll("li")).toHaveLength(5);
  expect(card.host.querySelector("li p")?.textContent).toMatch(/^https:\/\/bob.example/);
  expect(card.host.textContent).toContain("Sender (unverified): bob.example");
  expect(card.host.textContent).toContain("Editor (unverified)");
  expect(card.host.querySelector('a[href="/shared"]')?.textContent).toBe("View all shared items");
  await card.unmount();
  const view = await mount(h(SharedPage));
  expect(view.host.querySelectorAll("li")).toHaveLength(5);
  const buttons = () => [...view.host.querySelectorAll("button")];
  await act(async () =>
    buttons()
      .find((b) => b.textContent === "Clear")
      ?.click(),
  );
  expect(view.host.querySelectorAll("li")).toHaveLength(6);
  await act(async () =>
    buttons()
      .find((b) => b.textContent === "Sheets")
      ?.click(),
  );
  expect(view.host.querySelectorAll("li")).toHaveLength(1);
  expect(view.host.querySelector('a[href^="/docs/d/"]')).not.toBeNull();
  await act(async () =>
    buttons()
      .find((b) => b.textContent === "Remove")
      ?.click(),
  );
  expect(state.remove).toHaveBeenCalledWith(state.items[5]?.url);
  expect(view.host.textContent).toContain("Removed from Shared with me");
  await view.unmount();
});

it("renders loading, error/retry, and empty states", async () => {
  state.loading = true;
  let view = await mount(h(SharedPage));
  expect(view.host.querySelector('[aria-label="Loading shared items"]')).not.toBeNull();
  await view.unmount();
  state.loading = false;
  state.error = true;
  state.items = [];
  view = await mount(h(SharedPage));
  expect(view.host.textContent).toContain("Couldn't load shared announcements");
  expect(view.host.textContent).toContain("No shared items for these apps");
  await act(async () =>
    [...view.host.querySelectorAll("button")].find((b) => b.textContent === "Retry")?.click(),
  );
  expect(state.refresh).toHaveBeenCalled();
  await view.unmount();
});

it("keeps hidden items per account, handles disabled storage, and fences retained removals", async () => {
  let owner = "shared-test-alice";
  let current!: ReturnType<typeof useHiddenSharedItems>;
  function Probe() {
    current = useHiddenSharedItems(owner);
    return h("p", {}, String(current.hidden.length));
  }
  const view = await mount(h(Probe));
  const retained = current.remove;
  await act(async () => current.remove("https://bob.example/a"));
  expect(current.hidden).toEqual([{ url: "https://bob.example/a", hiddenAt: expect.any(String) }]);
  expect(localStorage.getItem(sharedAccountKey(owner))).toContain("https://bob.example/a");
  owner = "shared-test-bob";
  await view.render(h(Probe));
  expect(current.hidden).toEqual([]);
  await act(async () => retained("https://bob.example/should-not-hide"));
  expect(current.hidden).toEqual([]);
  const storage = Object.getPrototypeOf(localStorage);
  vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await act(async () => current.remove("https://bob.example/b"));
  expect(current.hidden).toEqual([{ url: "https://bob.example/b", hiddenAt: expect.any(String) }]);
  await view.unmount();
  const old = current.remove;
  await act(async () => old("https://bob.example/c"));
  expect(localStorage.getItem(sharedAccountKey("shared-test-alice"))).not.toContain(
    "should-not-hide",
  );
});

it("Home flags a claimed sender on a different pod and previews the resource", async () => {
  state.items = [
    {
      ...(state.items[0] as SharedItem),
      sharedBy: "https://evil.example/#me",
      fromAnotherPod: true,
    },
  ];
  const view = await mount(h(SharedCard));
  expect(view.host.querySelector("li p")?.textContent).toMatch(/^https:\/\/bob.example/);
  expect(view.host.textContent).toContain("Sender (unverified): evil.example");
  expect(view.host.textContent).toContain("from another pod");
  expect(view.host.querySelector('li a[href^="/drive/p/"]')).not.toBeNull();
  await view.unmount();
});
