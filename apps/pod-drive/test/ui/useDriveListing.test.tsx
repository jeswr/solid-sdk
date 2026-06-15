// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the data hook's race + lifecycle handling that the
// component test can't deterministically force: a slow load superseded by a
// newer navigation must NOT overwrite the newer state, and an aborted request
// must not surface an error.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDriveListing } from "../../src/ui/useDriveListing.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const TTL = (url: string) => `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${url}> a ldp:Container ; ldp:contains <${url}child> .
<${url}child> a ldp:Resource .
`;

function okFor(url: string): Response {
  const res = new Response(TTL(url), {
    status: 200,
    headers: { "content-type": "text/turtle" },
  });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("useDriveListing", () => {
  it("loads the root container on mount", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useDriveListing("https://pod.example/drive/", { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.currentUrl).toBe("https://pod.example/drive/");
    expect(result.current.listing?.container.entries).toHaveLength(1);
  });

  it("normalises a slashless navigate target to a trailing slash", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useDriveListing("https://pod.example/drive/", { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.navigate("https://pod.example/drive/sub"));
    expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/");
  });

  it("does not let a slow superseded load overwrite a newer navigation", async () => {
    // The FIRST (root) load hangs; navigation to /fast/ resolves immediately.
    // When root finally resolves it must be discarded as stale.
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/slow/") {
        await slow;
      }
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useDriveListing("https://pod.example/slow/", { fetch }));
    // Navigate away before the slow root resolves.
    act(() => result.current.navigate("https://pod.example/fast/"));
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/fast/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/fast/"));

    // Now release the stale slow load; it must NOT replace /fast/.
    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listing?.url).toBe("https://pod.example/fast/");
  });

  it("discards a superseded load that REJECTS after a newer navigation", async () => {
    // The root load hangs then throws; we navigate away first, so when it
    // finally rejects it must be swallowed by the catch-path staleness guard —
    // no error surfaces for the (now current) /fast/ container.
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/slow/") {
        await slow;
        throw new TypeError("slow load failed late");
      }
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useDriveListing("https://pod.example/slow/", { fetch }));
    act(() => result.current.navigate("https://pod.example/fast/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/fast/"));

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The late rejection of the stale slow load did NOT set an error.
    expect(result.current.error).toBeNull();
    expect(result.current.listing?.url).toBe("https://pod.example/fast/");
  });

  it("surfaces a generic error message for a non-access failure", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useDriveListing("https://pod.example/x/", { fetch }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(false);
  });
});
