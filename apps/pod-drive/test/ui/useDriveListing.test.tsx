// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the data hook's race + lifecycle handling that the
// component test can't deterministically force: a slow load superseded by a
// newer navigation must NOT overwrite the newer state, and an aborted request
// must not surface an error.

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { breadcrumbFor } from "../../src/ui/breadcrumb.js";
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

  it("normalises a slashless rootUrl: GETs the slash-terminated container and a correct breadcrumb", async () => {
    // A slashless root prop (".../drive") must still drive a slash-terminated
    // container GET and a "Drive"-rooted breadcrumb — not a single stray crumb
    // from the defensive "outside the root" branch.
    const fetched: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      fetched.push(url);
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useDriveListing("https://pod.example/drive", { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // currentUrl is normalised, the GET hit the slash-terminated container, and
    // the listing resolved against it.
    expect(result.current.currentUrl).toBe("https://pod.example/drive/");
    expect(fetched).toContain("https://pod.example/drive/");
    expect(result.current.listing?.url).toBe("https://pod.example/drive/");

    // The breadcrumb (derived from the normalised currentUrl) is the single
    // "Drive" root crumb — NOT a degenerate one from the slashless-mismatch path.
    const crumbs = breadcrumbFor(result.current.currentUrl, "https://pod.example/drive");
    expect(crumbs).toEqual([{ url: "https://pod.example/drive/", label: "Drive" }]);
  });

  it("resets navigation to the new container when the rootUrl prop changes", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useDriveListing(root, { fetch }),
      { initialProps: { root: "https://pod.example/drive/" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Navigate down into the first root's tree.
    act(() => result.current.navigate("https://pod.example/drive/sub"));
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/drive/sub/"));

    // Parent re-renders with a DIFFERENT root: navigation must reset to it, not
    // stay stranded on the previous container's sub-folder.
    rerender({ root: "https://pod.example/other/" });
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/other/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/other/"));
    expect(result.current.error).toBeNull();

    // Breadcrumb now roots at the NEW container.
    const crumbs = breadcrumbFor(result.current.currentUrl, "https://pod.example/other/");
    expect(crumbs).toEqual([{ url: "https://pod.example/other/", label: "Drive" }]);
  });

  it("resets to the new root even when the changed rootUrl prop is slashless", async () => {
    // The reset keys off the NORMALISED root, so a slashless new prop that
    // normalises to the same container is still detected as a change and resets.
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useDriveListing(root, { fetch }),
      { initialProps: { root: "https://pod.example/drive/" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.navigate("https://pod.example/drive/sub"));
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/"));

    rerender({ root: "https://pod.example/other" });
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/other/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/other/"));
  });

  it("resets via committed state — survives StrictMode's double render of a root change", async () => {
    // StrictMode double-invokes render in development, the closest deterministic
    // proxy for the concurrent "abandoned render" hazard the fix guards against.
    // The previous-root is tracked in STATE (set during render, applied only on
    // commit) rather than a ref written during render: were it a ref, the extra
    // render invocation could leave the tracker out of step and make a later
    // committed render skip the reset, stranding `currentUrl` on the old root.
    // With state it stays correct — each committed root change resets cleanly.
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useDriveListing(root, { fetch }),
      {
        initialProps: { root: "https://pod.example/drive/" },
        wrapper: StrictMode,
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.navigate("https://pod.example/drive/sub"));
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/"));

    // First root change resets to the new container despite the double render.
    rerender({ root: "https://pod.example/other/" });
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/other/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/other/"));

    // Navigate down again, then change root a SECOND time: the state-tracked
    // previous root must again detect the change and reset (a leaked ref write
    // from an abandoned render would have desynced this second detection).
    act(() => result.current.navigate("https://pod.example/other/nested"));
    await waitFor(() =>
      expect(result.current.currentUrl).toBe("https://pod.example/other/nested/"),
    );

    rerender({ root: "https://pod.example/third/" });
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/third/"));
    await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/third/"));
    expect(result.current.error).toBeNull();
  });

  it("does NOT reset navigation when the rootUrl prop is unchanged across a re-render", async () => {
    // A parent re-render that passes the SAME (normalised) root must leave the
    // current navigation intact — the reset is gated on an actual root change.
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useDriveListing(root, { fetch }),
      { initialProps: { root: "https://pod.example/drive/" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.navigate("https://pod.example/drive/sub"));
    await waitFor(() => expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/"));

    // Re-render with an unchanged root (and a slashless spelling of the same
    // root — both normalise identically, so neither is treated as a change).
    rerender({ root: "https://pod.example/drive/" });
    rerender({ root: "https://pod.example/drive" });
    expect(result.current.currentUrl).toBe("https://pod.example/drive/sub/");
  });
});
