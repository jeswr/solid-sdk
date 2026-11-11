// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { type DeckRepository, newDeck } from "@jeswr/solid-slides";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../../src/lib/session/pod-session";
import { act, h, mount } from "../drive-ui-dom";

const fixtures = vi.hoisted(() => ({ connect: vi.fn(), seed: vi.fn(), error: vi.fn() }));
vi.mock("../../src/apps/slides/lib/data/connect", () => ({ connectSlides: fixtures.connect }));
vi.mock("../../src/apps/slides/demo/sample", () => ({ seedSlides: fixtures.seed }));
vi.mock("@jeswr/suite-ui", () => ({ toast: { error: fixtures.error } }));

import { SlidesProvider, useSlides } from "../../src/apps/slides/state/slides-context";

const session = {
  mode: "demo",
  webId: "https://pod.example/profile#me",
  storageUrl: "https://pod.example/",
  fetch: vi.fn(),
} as unknown as PodSession;
const key = `solid-slides:drafts:${session.mode}:${session.webId}:${session.storageUrl}`;
let current: ReturnType<typeof useSlides>;
function Reader() {
  current = useSlides();
  return h("output", null, current.decks.map((entry) => entry.deck.name).join(","));
}
function node() {
  return h(SlidesProvider, {
    session,
    fallback: (error, retry) => h("button", { onClick: retry }, error ? "Retry" : "Opening"),
    children: h(Reader),
  });
}
function repository() {
  return {
    container: "https://pod.example/slides/",
    initialise: vi.fn(async () => {}),
    list: vi.fn(async () => ({ decks: [], broken: [] })),
    save: vi.fn(
      async (
        item: import("@jeswr/solid-slides").StoredDeck,
        deck: import("@jeswr/solid-slides").Deck,
      ) => ({ ...item, deck }),
    ),
    create: vi.fn(async (deck: import("@jeswr/solid-slides").Deck) => ({
      url: "https://pod.example/slides/new.ttl",
      etag: '"1"',
      deck,
    })),
    remove: vi.fn(async () => {}),
  } as unknown as DeckRepository;
}
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  fixtures.connect.mockReset();
  fixtures.seed.mockReset();
});
it("requires a provider", async () => {
  await expect(mount(h(Reader))).rejects.toThrow("provider");
});
it("boots, restores drafts, exposes optimistic state and flushes on hidden/pagehide/online", async () => {
  const repo = repository();
  fixtures.connect.mockResolvedValue(repo);
  fixtures.seed.mockResolvedValue(undefined);
  localStorage.setItem(
    key,
    JSON.stringify([
      { url: "https://pod.example/slides/old.ttl", etag: '"1"', deck: newDeck("Recovered") },
    ]),
  );
  const view = await mount(node());
  expect(view.host.textContent).toContain("Recovered");
  await act(async () => {
    current.store.edit("https://pod.example/slides/old.ttl", newDeck("Edited"));
  });
  expect(view.host.textContent).toContain("Edited");
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(repo.save).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ name: "Edited" }),
    true,
  );
  await act(async () => {
    current.store.edit("https://pod.example/slides/old.ttl", newDeck("Again"));
    window.dispatchEvent(new Event("online"));
  });
  expect(repo.save).toHaveBeenCalledTimes(2);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  visibility.mockReturnValue("hidden");
  await act(async () => {
    current.store.edit("https://pod.example/slides/old.ttl", newDeck("Background"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(repo.save).toHaveBeenCalledTimes(3);
  await act(async () => {
    current.store.edit("https://pod.example/slides/old.ttl", newDeck("Leaving"));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  await act(async () => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  await view.unmount();
});
it("surfaces boot errors, retries and cleans up an opening session", async () => {
  fixtures.connect.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(repository());
  const view = await mount(node());
  expect(view.host.textContent).toContain("Retry");
  await act(async () => view.host.querySelector("button")?.click());
  expect(view.host.textContent).not.toContain("Retry");
  await view.unmount();
  let finish!: (repo: DeckRepository) => void;
  fixtures.connect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const opening = await mount(node());
  expect(opening.host.textContent).toBe("Opening");
  await opening.unmount();
  await act(async () => finish(repository()));
});
it("can open the pod if browser storage is unavailable, and ignores late boot failures", async () => {
  fixtures.connect.mockResolvedValue(repository());
  const storage = vi
    .spyOn(Object.getPrototypeOf(localStorage), "getItem")
    .mockImplementation(() => {
      throw Error("blocked");
    });
  const view = await mount(node());
  expect(view.host.textContent).not.toContain("Retry");
  storage.mockRestore();
  await view.unmount();
  let reject!: (error: Error) => void;
  fixtures.connect.mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const opening = await mount(node());
  await opening.unmount();
  await act(async () => reject(new Error("late")));
});
it("reports a corrupt retained draft through the shared toast", async () => {
  fixtures.connect.mockResolvedValue(repository());
  localStorage.setItem(key, "corrupt");
  const view = await mount(node());
  expect(fixtures.error).toHaveBeenCalledWith(expect.stringContaining("saved draft"));
  await view.unmount();
});
it("lists broken files beside the decks, and flushes hidden tabs without a teardown flight", async () => {
  const repo = repository();
  const broken = [{ url: "https://pod.example/slides/bad.ttl", reason: "invalid" }];
  vi.mocked(repo.list).mockResolvedValue({
    decks: [{ url: "https://pod.example/slides/a.ttl", etag: '"1"', deck: newDeck("Good") }],
    broken,
  } as never);
  fixtures.connect.mockResolvedValue(repo);
  const view = await mount(node());
  expect(view.host.textContent).toContain("Good");
  expect(current.broken).toEqual(broken);
  const flush = vi.spyOn(current.store, "flush");
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(flush).toHaveBeenLastCalledWith(true, false);
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(flush).toHaveBeenLastCalledWith(true, true);
  visibility.mockRestore();
  await view.unmount();
});
it("keeps another window's crash-recovery drafts when this window saves its own", async () => {
  const repo = repository();
  fixtures.connect.mockResolvedValue(repo);
  const elsewhere = {
    version: 2,
    windows: {
      open: {
        at: Date.now(),
        value: JSON.stringify({
          drafts: [
            { url: "https://pod.example/slides/theirs.ttl", etag: '"1"', deck: newDeck("Theirs") },
          ],
        }),
      },
    },
  };
  localStorage.setItem(key, JSON.stringify(elsewhere));
  const view = await mount(node());
  expect(view.host.textContent).not.toContain("Theirs");
  await act(async () => {
    current.store.add(newDeck("Mine"));
  });
  const saved = JSON.parse(localStorage.getItem(key) as string);
  expect(saved.windows.open).toEqual(elsewhere.windows.open);
  expect(Object.keys(saved.windows)).toHaveLength(2);
  await view.unmount();
});
