// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { BookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { createBookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { createPodClient } from "@jeswr/storage-client";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/bookmarks/demo/sample";
import {
  BookmarksProvider,
  useBookmarkSnapshot,
  useBookmarks,
} from "../src/apps/bookmarks/state/bookmarks-context";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("@jeswr/storage-client", () => ({ createPodClient: vi.fn(async () => ({ storage: {} })) }));
vi.mock("@jeswr/solid-bookmark/pod", () => ({ createBookmarkRepository: vi.fn() }));
vi.mock("../src/apps/bookmarks/demo/sample", () => ({ ensureSample: vi.fn(async () => {}) }));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@jeswr/suite-ui", async () => {
  const React = await import("react");
  return {
    toast: { error: notify },
    ErrorState: ({
      children,
      actions,
    }: {
      children: React.ReactNode;
      actions: { retry(): void };
    }) =>
      React.createElement(
        "div",
        null,
        children,
        React.createElement("button", { onClick: actions.retry }, "Try again"),
      ),
  };
});
function Probe() {
  const state = useBookmarkSnapshot();
  const store = useBookmarks();
  return (
    <div>
      <span>
        {state.status}:{state.items.length}
      </span>
      <button
        type="button"
        onClick={() => {
          void store?.edit(["https://pod.example/one.ttl"], { title: "Edit" });
        }}
      >
        Edit
      </button>
    </div>
  );
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const repo: BookmarkRepository = {
    registration: "registered",
    initialize: vi.fn(async () => {}),
    list: vi.fn(async () => ({
      items: [
        { url: "https://pod.example/one.ttl", etag: '"1"', data: { url: "https://example.org/" } },
      ],
      skipped: [],
    })),
    create: vi.fn(),
    update: vi.fn(async () => {
      throw new Error("offline");
    }),
    remove: vi.fn(),
  };
  vi.mocked(createBookmarkRepository).mockReturnValue(repo);
  let changed: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const session: PodSession = {
    mode: "demo",
    storageUrl: "https://pod.example/",
    webId: "https://pod.example/profile#me",
    displayName: "Fictional reader",
    fetch: fetch,
    reset: vi.fn(),
    subscribe: (listener) => {
      changed = () => listener("https://pod.example/one.ttl");
      return unsubscribe;
    },
  };
  return {
    host,
    root,
    repo,
    session,
    unsubscribe,
    changed: () => changed?.(),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("has a safe loading snapshot outside its provider", async () => {
  const f = fixture();
  try {
    await act(async () => f.root.render(<Probe />));
    expect(f.host.textContent).toContain("loading:0");
  } finally {
    await f.close();
  }
});
it("supplies a deterministic server snapshot without opening a pod", () => {
  expect(renderToString(<Probe />)).toContain("loading");
  expect(createBookmarkRepository).not.toHaveBeenCalled();
});
it("defers notification refreshes while an optimistic write is outstanding", async () => {
  const f = fixture();
  let finish!: () => void;
  vi.mocked(f.repo.update).mockImplementationOnce(async (record, patch) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { ...record, data: { ...record.data, ...patch } };
  });
  try {
    await act(async () =>
      f.root.render(
        <BookmarksProvider session={f.session}>
          <Probe />
        </BookmarksProvider>,
      ),
    );
    await act(async () => f.host.querySelector("button")?.click());
    await act(async () => f.changed());
    expect(f.repo.list).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  } finally {
    await f.close();
  }
});
it("ignores an initialisation failure after the account has closed", async () => {
  const f = fixture();
  let fail!: (error: Error) => void;
  vi.mocked(ensureSample).mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      fail = reject;
    }),
  );
  await act(async () =>
    f.root.render(
      <BookmarksProvider session={f.session}>
        <Probe />
      </BookmarksProvider>,
    ),
  );
  await f.close();
  await act(async () => fail(new Error("Late failure")));
  expect(f.repo.list).not.toHaveBeenCalled();
});
it("loads the session, reconciles change events, reports save failures and unsubscribes", async () => {
  const f = fixture();
  try {
    await act(async () =>
      f.root.render(
        <BookmarksProvider session={f.session}>
          <Probe />
        </BookmarksProvider>,
      ),
    );
    expect(f.host.textContent).toContain("ready:1");
    expect(createPodClient).toHaveBeenCalledWith({
      storage: f.session.storageUrl,
      fetch: f.session.fetch,
      capabilities: expect.any(Object),
      signal: expect.any(AbortSignal),
    });
    expect(createBookmarkRepository).toHaveBeenCalledWith({
      storage: expect.any(Object),
      fetch: f.session.fetch,
      profile: f.session.webId,
    });
    await act(async () => f.changed());
    expect(f.repo.list).toHaveBeenCalledTimes(2);
    await act(async () => f.host.querySelector("button")?.click());
    expect(notify).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.mocked(createPodClient).mock.calls[0]?.[0].signal?.aborted).toBe(true);
});
it("aborts pending discovery on teardown and ignores a late discovery result", async () => {
  const f = fixture();
  let finish!: (pod: Awaited<ReturnType<typeof createPodClient>>) => void;
  vi.mocked(createPodClient).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () =>
    f.root.render(
      <BookmarksProvider session={f.session}>
        <Probe />
      </BookmarksProvider>,
    ),
  );
  const signal = vi.mocked(createPodClient).mock.calls[0]?.[0].signal;
  expect(signal?.aborted).toBe(false);
  await f.close();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ storage: {} } as Awaited<ReturnType<typeof createPodClient>>));
  expect(ensureSample).not.toHaveBeenCalled();
  expect(createBookmarkRepository).not.toHaveBeenCalled();
});
it("times out hung discovery, aborts it and retries with a fresh signal", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: (pod: Awaited<ReturnType<typeof createPodClient>>) => void;
  vi.mocked(createPodClient).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  try {
    await act(async () =>
      f.root.render(
        <BookmarksProvider session={f.session}>
          <Probe />
        </BookmarksProvider>,
      ),
    );
    const first = vi.mocked(createPodClient).mock.calls[0]?.[0].signal;
    expect(f.host.textContent).toContain("loading:0");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(first?.aborted).toBe(true);
    expect(f.host.textContent).toContain("Couldn't open");
    expect(createBookmarkRepository).not.toHaveBeenCalled();
    // A transport that ignores abort must not open a repository after the deadline.
    await act(async () => finish({ storage: {} } as Awaited<ReturnType<typeof createPodClient>>));
    expect(createBookmarkRepository).not.toHaveBeenCalled();
    expect(f.host.textContent).toContain("Couldn't open");
    await act(async () => f.host.querySelector("button")?.click());
    const second = vi.mocked(createPodClient).mock.calls[1]?.[0].signal;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.aborted).toBe(false);
    expect(f.host.textContent).toContain("ready:1");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(f.host.textContent).toContain("ready:1");
  } finally {
    await f.close();
  }
});
it("shows SDK discovery failures without falling back to a protocol-specific client", async () => {
  const f = fixture();
  vi.mocked(createPodClient).mockRejectedValueOnce(new Error("Missing discovery metadata"));
  try {
    await act(async () =>
      f.root.render(
        <BookmarksProvider session={f.session}>
          <Probe />
        </BookmarksProvider>,
      ),
    );
    expect(f.host.textContent).toContain("Couldn't open");
    expect(createBookmarkRepository).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it("shows initialisation errors and retries without a page reload", async () => {
  const f = fixture();
  vi.mocked(ensureSample).mockRejectedValueOnce(new Error("No pod"));
  try {
    await act(async () =>
      f.root.render(
        <BookmarksProvider session={f.session}>
          <Probe />
        </BookmarksProvider>,
      ),
    );
    expect(f.host.textContent).toContain("Couldn't open");
    await act(async () => f.host.querySelector("button")?.click());
    expect(f.host.textContent).toContain("ready:1");
  } finally {
    await f.close();
  }
});
it("ignores initialisation that completes after teardown", async () => {
  const f = fixture();
  let finish!: () => void;
  vi.mocked(ensureSample).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () =>
    f.root.render(
      <BookmarksProvider session={f.session}>
        <Probe />
      </BookmarksProvider>,
    ),
  );
  await f.close();
  await act(async () => finish());
  expect(f.repo.list).not.toHaveBeenCalled();
});
