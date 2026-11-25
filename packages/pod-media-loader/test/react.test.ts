// @vitest-environment jsdom
// AUTHORED-BY Claude Sonnet 5.5
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import type { MediaError } from "../src/errors.js";
import { createMediaLoader, type MediaHandle, type MediaLoader } from "../src/loader.js";
import { type UseMediaResult, useMedia } from "../src/react.js";
import { deferred, type FakeRead, fakeStorage, fakeUrls, MEDIA, png, served } from "./helpers.js";

afterEach(cleanup);

const at = (name: string) => `${MEDIA}${name}.png`;

/** A real loader whose handles are counted, so leaked holds are visible. */
function tracked(overrides: Record<string, unknown> = {}) {
  const urls = fakeUrls();
  const fake = fakeStorage((url) => served(png(url.length, 1)));
  const base = createMediaLoader({
    storage: fake.storage,
    scope: [MEDIA],
    maxBytes: 1 << 20,
    maxTotalBytes: 16 << 20,
    maxEntries: 8,
    objectUrls: urls.api,
    ...overrides,
  });
  const holds = new Set<MediaHandle>();
  let acquires = 0;
  const loader: MediaLoader = {
    ...base,
    async acquire(url, options) {
      acquires++;
      const result = await base.acquire(url, options);
      if (result.ok) {
        const inner = result.value;
        const wrapped: MediaHandle = {
          url: inner.url,
          contentType: inner.contentType,
          bytes: inner.bytes,
          release() {
            holds.delete(wrapped);
            inner.release();
          },
        };
        holds.add(wrapped);
        return { ok: true, value: wrapped };
      }
      return result;
    },
  };
  return { loader, urls, holds, acquires: () => acquires, fake };
}

const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);

describe("useMedia", () => {
  test("is idle without a URL and never touches the loader", () => {
    const { loader, acquires } = tracked();
    for (const url of [undefined, null, ""]) {
      const { result } = renderHook(() => useMedia(loader, url));
      expect(result.current).toEqual({ status: "idle", url: undefined, error: undefined });
    }
    expect(acquires()).toBe(0);
  });

  test("loads, then exposes the blob URL", async () => {
    const { loader, urls } = tracked();
    const { result } = renderHook(() => useMedia(loader, at("a")));
    expect(result.current).toEqual({ status: "loading", url: undefined, error: undefined });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.url).toMatch(/^blob:/);
    expect(urls.blobOf(result.current.url as string).type).toBe("image/png");
    expect(result.current.error).toBeUndefined();
  });

  test("reports a closed error", async () => {
    const { loader } = tracked();
    const { result } = renderHook(() => useMedia(loader, "https://elsewhere.example/a.png"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    const error = result.current.error as MediaError;
    expect(error.code).toBe("out-of-scope");
    expect(result.current.url).toBeUndefined();
  });

  test("releases on unmount", async () => {
    const { loader, holds } = tracked();
    const { result, unmount } = renderHook(() => useMedia(loader, at("a")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(holds.size).toBe(1);
    unmount();
    expect(holds.size).toBe(0);
  });

  test("a URL change releases the old hold, shows loading, then the new media", async () => {
    const { loader, holds } = tracked();
    const { result, rerender } = renderHook(({ url }) => useMedia(loader, url), {
      initialProps: { url: at("a") },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.url;
    rerender({ url: at("bbbb") });
    // Never the previous URL's blob under the new URL.
    expect(result.current).toEqual({ status: "loading", url: undefined, error: undefined });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.url).not.toBe(first);
    expect(holds.size).toBe(1);
  });

  test("going back to no URL releases and goes idle", async () => {
    const { loader, holds } = tracked();
    const { result, rerender } = renderHook(({ url }) => useMedia(loader, url), {
      initialProps: { url: at("a") as string | undefined },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ url: undefined });
    expect(result.current.status).toBe("idle");
    expect(holds.size).toBe(0);
  });

  test("a different loader reloads; the inert option is part of the key", async () => {
    const one = tracked();
    const two = tracked();
    const { result, rerender } = renderHook(
      ({ loader, inert }) => useMedia(loader, at("a"), { inert }),
      { initialProps: { loader: one.loader, inert: false } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ loader: two.loader, inert: false });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(one.holds.size).toBe(0);
    expect(two.holds.size).toBe(1);
    rerender({ loader: two.loader, inert: true });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  test("inert mode shows non-media as an octet-stream blob", async () => {
    const urls = fakeUrls();
    const fake = fakeStorage(() => served(new TextEncoder().encode("<svg/>")));
    const loader = createMediaLoader({
      storage: fake.storage,
      scope: [MEDIA],
      maxBytes: 1000,
      maxTotalBytes: 1000,
      maxEntries: 2,
      objectUrls: urls.api,
    });
    const strictResult = renderHook(() => useMedia(loader, at("a")));
    await waitFor(() => expect(strictResult.result.current.status).toBe("error"));
    const inertResult = renderHook(() => useMedia(loader, at("a"), { inert: true }));
    await waitFor(() => expect(inertResult.result.current.status).toBe("ready"));
    expect(urls.blobOf(inertResult.result.current.url as string).type).toBe(
      "application/octet-stream",
    );
  });

  test("a result that arrives after unmount is released, never shown", async () => {
    const gate = deferred<void>();
    const released: string[] = [];
    const loader = {
      async acquire() {
        await gate.promise;
        return {
          ok: true as const,
          value: {
            url: "blob:late",
            contentType: "image/png",
            bytes: 1,
            release: () => released.push("late"),
          },
        };
      },
      subscribe: () => () => undefined,
    } as unknown as MediaLoader;
    const { unmount } = renderHook(() => useMedia(loader, at("a")));
    unmount();
    gate.resolve();
    await waitFor(() => expect(released).toEqual(["late"]));
  });

  test("a failure that arrives after unmount is ignored", async () => {
    const gate = deferred<void>();
    const loader = {
      async acquire() {
        await gate.promise;
        return { ok: false as const, error: { code: "failed", message: "x" } };
      },
      subscribe: () => () => undefined,
    } as unknown as MediaLoader;
    const { unmount, result } = renderHook(() => useMedia(loader, at("a")));
    unmount();
    gate.resolve();
    await Promise.resolve();
    expect(result.current.status).toBe("loading");
  });

  test("passes an abort signal that fires on cleanup", async () => {
    const signals: AbortSignal[] = [];
    const loader = {
      acquire: (_url: string, options?: { signal?: AbortSignal }) => {
        signals.push(options?.signal as AbortSignal);
        return new Promise(() => undefined);
      },
      subscribe: () => () => undefined,
    } as unknown as MediaLoader;
    const { unmount } = renderHook(() => useMedia(loader, at("a")));
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("useMedia under StrictMode", () => {
  test("double effects leave exactly one hold, and unmount leaves none", async () => {
    const { loader, holds, acquires, urls } = tracked();
    const { result, unmount } = renderHook(() => useMedia(loader, at("a")), { wrapper: strict });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(holds.size).toBe(1));
    expect(acquires()).toBe(2);
    expect(urls.created.size).toBe(1);
    expect(urls.revoked).toEqual([]);
    unmount();
    expect(holds.size).toBe(0);
  });

  test("a URL change under StrictMode still holds exactly one", async () => {
    const { loader, holds } = tracked();
    const { result, rerender, unmount } = renderHook(({ url }) => useMedia(loader, url), {
      wrapper: strict,
      initialProps: { url: at("a") },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ url: at("bbbb") });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(holds.size).toBe(1));
    unmount();
    expect(holds.size).toBe(0);
  });

  test("the entry survives the discarded first mount and is the one shown", async () => {
    const { loader, urls } = tracked();
    const { result } = renderHook(() => useMedia(loader, at("a")), { wrapper: strict });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(urls.live()).toContain(result.current.url);
  });
});

describe.each([
  ["without StrictMode", undefined],
  ["under StrictMode", strict],
])("a released URL is never shown again (%s)", (_name, wrapper) => {
  test("A, then no URL, then A again after eviction", async () => {
    const { loader, urls } = tracked({ maxEntries: 2 });
    const renders: UseMediaResult[] = [];
    const { result, rerender } = renderHook(
      ({ url }: { url: string | undefined }) => {
        const value = useMedia(loader, url);
        renders.push(value);
        return value;
      },
      { initialProps: { url: at("a") as string | undefined }, ...(wrapper ? { wrapper } : {}) },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.url as string;
    rerender({ url: undefined });
    for (const name of ["bbbb", "cccc"]) {
      const other = await loader.acquire(at(name));
      if (other.ok) other.value.release();
    }
    expect(urls.revoked).toContain(first);
    renders.length = 0;
    rerender({ url: at("a") });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    for (const seen of renders) expect(seen.url).not.toBe(first);
    expect(result.current.url).not.toBe(first);
  });

  test("A, then B still loading, then A invalidated and requested again", async () => {
    const urls = fakeUrls();
    const gate = deferred<FakeRead>();
    const fake = fakeStorage((url) => (url.endsWith("b.png") ? gate.promise : served(png())));
    const loader = createMediaLoader({
      storage: fake.storage,
      scope: [MEDIA],
      maxBytes: 1 << 20,
      maxTotalBytes: 8 << 20,
      maxEntries: 8,
      objectUrls: urls.api,
    });
    const renders: UseMediaResult[] = [];
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => {
        const value = useMedia(loader, url);
        renders.push(value);
        return value;
      },
      { initialProps: { url: at("a") }, ...(wrapper ? { wrapper } : {}) },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.url as string;
    rerender({ url: at("b") });
    expect(result.current.status).toBe("loading");
    loader.invalidate(at("a"));
    expect(urls.revoked).toContain(first);
    renders.length = 0;
    rerender({ url: at("a") });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    for (const seen of renders) expect(seen.url).not.toBe(first);
    gate.resolve(served(png()));
  });
});

describe("purge reaches mounted hooks", () => {
  test("a purge moves a ready hook to an error state without ever rendering a revoked URL", async () => {
    const { loader, urls, holds } = tracked();
    const renders: UseMediaResult[] = [];
    const { result } = renderHook(() => {
      const value = useMedia(loader, at("a"));
      renders.push(value);
      return value;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const url = result.current.url as string;
    renders.length = 0;
    act(() => loader.purge());
    expect(urls.revoked).toContain(url);
    expect(result.current).toMatchObject({
      status: "error",
      url: undefined,
      error: { code: "purged" },
    });
    for (const seen of renders) expect(seen.url).toBeUndefined();
    expect(holds.size).toBe(0);
  });

  test("after resume a remount loads again", async () => {
    const { loader } = tracked();
    const first = renderHook(() => useMedia(loader, at("a")));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    act(() => loader.purge());
    first.unmount();
    loader.resume();
    const second = renderHook(() => useMedia(loader, at("a")));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
  });

  test("a session change purges mounted hooks too, and unmount unsubscribes", async () => {
    let who = "alice";
    const { loader, urls } = tracked({ getSessionKey: () => who });
    const hook = renderHook(() => useMedia(loader, at("a")));
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const url = hook.result.current.url as string;
    who = "bob";
    await act(async () => {
      await loader.acquire(at("other"));
    });
    expect(urls.revoked).toContain(url);
    expect(hook.result.current.status).toBe("error");
    let unsubscribed = 0;
    const fake = {
      acquire: () => new Promise(() => undefined),
      subscribe: () => () => {
        unsubscribed++;
      },
    } as unknown as MediaLoader;
    renderHook(() => useMedia(fake, at("a"))).unmount();
    expect(unsubscribed).toBe(1);
  });
});
