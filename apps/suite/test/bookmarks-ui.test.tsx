// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookmarksApp } from "../src/apps/bookmarks/components/bookmarks-app";
import type { LibrarySnapshot } from "../src/apps/bookmarks/state/library-store";

let snapshot: LibrarySnapshot;
vi.mock("../src/apps/bookmarks/state/bookmarks-context", () => ({
  BookmarksProvider: ({ children }: { children: ReactNode }) => children,
  useBookmarkSnapshot: () => snapshot,
  useBookmarks: () => ({}),
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: {} }),
}));
vi.mock("../src/shell/app-frame", () => ({
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
  AppHeading: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  AppFrame: ({ children, sidebar }: { children: ReactNode; sidebar: ReactNode }) => (
    <div>
      {sidebar}
      {children}
    </div>
  ),
}));
vi.mock("../src/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {} }));
  snapshot = {
    items: [
      { id: "one", data: { url: "https://example.org/", title: "First" } },
      { id: "two", data: { url: "https://example.net/", title: "Second", archived: true } },
    ],
    skipped: [],
    registration: "registered",
    status: "ready",
    error: null,
    saving: 0,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<BookmarksApp />));
const click = (element: Element | null) => act(async () => (element as HTMLElement)?.click());
const liveCount = () => host.querySelector(".bkm-selection [role=status]")?.textContent;

it("shows select-all as mixed for a partial selection and supports clearing/toggling it", async () => {
  await render();
  const all = host.querySelector('[aria-label="Select all visible bookmarks"]');
  expect(all?.getAttribute("aria-checked")).toBe("false");
  await click(host.querySelector('[aria-label="Select First"]'));
  expect(all?.getAttribute("aria-checked")).toBe("mixed");
  await click(all);
  expect(all?.getAttribute("aria-checked")).toBe("true");
  await click(all);
  expect(all?.getAttribute("aria-checked")).toBe("false");
});

it("announces only debounced user filter count changes, keeping the message stable during reads and selection", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(liveCount()).toBe("");
  await click(host.querySelector('[aria-label="Select First"]'));
  expect(liveCount()).toBe("");
  const unread = Array.from(host.querySelectorAll("nav[aria-label='Bookmark views'] button")).find(
    (button) => button.textContent?.startsWith("Unread"),
  );
  await click(unread ?? null);
  expect(liveCount()).toBe("");
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  expect(liveCount()).toBe("1 bookmark");
  snapshot = {
    ...snapshot,
    items: [...snapshot.items, { id: "three", data: { url: "https://example.com/" } }],
  };
  await render();
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(liveCount()).toBe("1 bookmark");
  await click(unread ?? null);
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(liveCount()).toBe("1 bookmark");
});

it("keeps healthy bookmarks visible with a quiet child failure notice and dismissible registration hint", async () => {
  snapshot = {
    ...snapshot,
    registration: "failed",
    skipped: [{ url: "https://pod.example/denied", reason: "forbidden" }],
  };
  await render();
  expect(host.querySelectorAll(".bkm-item")).toHaveLength(2);
  expect(host.textContent).toContain("1 item couldn't be read.");
  const dismiss = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Dismiss hint",
  );
  expect(host.textContent).toContain("Other apps may not find them yet");
  await click(dismiss ?? null);
  expect(host.textContent).not.toContain("Other apps may not find them yet");
  snapshot = {
    ...snapshot,
    skipped: [...snapshot.skipped, { url: "https://pod.example/network", reason: "network" }],
  };
  await render();
  expect(host.textContent).toContain("2 items couldn't be read.");
  expect(host.textContent).not.toContain("Other apps may not find them yet");
});

it("does not warn about removed or non-RDF children", async () => {
  snapshot = {
    ...snapshot,
    skipped: [
      { url: "https://pod.example/gone", reason: "not-found" },
      { url: "https://pod.example/marker", reason: "not-rdf" },
    ],
  };
  await render();
  expect(host.textContent).not.toContain("couldn't be read");
});
