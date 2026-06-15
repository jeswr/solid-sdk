// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the data hook's race + lifecycle handling that the
// component test can't deterministically force: a slow load superseded by a
// newer resource must NOT overwrite the newer state, an aborted/late-rejecting
// request must not surface an error, and a resourceUrl prop change resets the
// view (correctly, via committed STATE — surviving StrictMode's double render).

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHealthRecords } from "../../src/ui/useHealthRecords.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const TTL = (iri: string) => `
@prefix health: <https://TBD.example/solid/health#> .
@prefix core:   <https://TBD.example/solid/core#> .
<${iri}#cond> a health:Condition ; health:hasCode <${iri}#code> .
`;

function okFor(url: string): Response {
  const res = new Response(TTL(url), {
    status: 200,
    headers: { "content-type": "text/turtle" },
  });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("useHealthRecords", () => {
  it("loads the resource on mount and flattens its entries", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useHealthRecords("https://pod.example/health/a.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(result.current.resourceUrl).toBe("https://pod.example/health/a.ttl");
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.kind).toBe("Condition");
  });

  it("trims whitespace off the resource url but does NOT add a trailing slash", async () => {
    const fetched: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      fetched.push(url);
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useHealthRecords("  https://pod.example/health/a.ttl  ", { fetch }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Trimmed, and a RESOURCE (no trailing slash appended).
    expect(result.current.resourceUrl).toBe("https://pod.example/health/a.ttl");
    expect(fetched).toContain("https://pod.example/health/a.ttl");
  });

  it("does not let a slow superseded load overwrite a newer resource change", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/health/slow.ttl") {
        await slow;
      }
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthRecords(url, { fetch }),
      { initialProps: { url: "https://pod.example/health/slow.ttl" } },
    );
    // Change resource before the slow one resolves.
    rerender({ url: "https://pod.example/health/fast.ttl" });
    await waitFor(() =>
      expect(result.current.resourceUrl).toBe("https://pod.example/health/fast.ttl"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Release the stale slow load; it must NOT replace the fast resource's view.
    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resourceUrl).toBe("https://pod.example/health/fast.ttl");
    expect(result.current.error).toBeNull();
  });

  it("discards a superseded load that REJECTS after a newer resource change", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/health/slow.ttl") {
        await slow;
        throw new TypeError("slow load failed late");
      }
      return okFor(url);
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthRecords(url, { fetch }),
      { initialProps: { url: "https://pod.example/health/slow.ttl" } },
    );
    rerender({ url: "https://pod.example/health/fast.ttl" });
    await waitFor(() =>
      expect(result.current.resourceUrl).toBe("https://pod.example/health/fast.ttl"),
    );

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The late rejection of the stale slow load did NOT set an error.
    expect(result.current.error).toBeNull();
  });

  it("surfaces a generic error message for a non-access failure", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useHealthRecords("https://pod.example/health/x.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(false);
    expect(result.current.loaded).toBe(true);
  });

  it("resets the view when the resourceUrl prop changes", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthRecords(url, { fetch }),
      { initialProps: { url: "https://pod.example/health/a.ttl" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries[0]?.iri).toBe("https://pod.example/health/a.ttl#cond");

    rerender({ url: "https://pod.example/health/b.ttl" });
    await waitFor(() =>
      expect(result.current.resourceUrl).toBe("https://pod.example/health/b.ttl"),
    );
    await waitFor(() =>
      expect(result.current.entries[0]?.iri).toBe("https://pod.example/health/b.ttl#cond"),
    );
    expect(result.current.error).toBeNull();
  });

  it("resets via committed state — survives StrictMode's double render of a resource change", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthRecords(url, { fetch }),
      {
        initialProps: { url: "https://pod.example/health/a.ttl" },
        wrapper: StrictMode,
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ url: "https://pod.example/health/b.ttl" });
    await waitFor(() =>
      expect(result.current.resourceUrl).toBe("https://pod.example/health/b.ttl"),
    );
    await waitFor(() =>
      expect(result.current.entries[0]?.iri).toBe("https://pod.example/health/b.ttl#cond"),
    );

    // A SECOND change must again detect + reset (a leaked ref write from an
    // abandoned render would have desynced this second detection).
    rerender({ url: "https://pod.example/health/c.ttl" });
    await waitFor(() =>
      expect(result.current.resourceUrl).toBe("https://pod.example/health/c.ttl"),
    );
    await waitFor(() =>
      expect(result.current.entries[0]?.iri).toBe("https://pod.example/health/c.ttl#cond"),
    );
    expect(result.current.error).toBeNull();
  });

  it("does NOT reset when the resourceUrl prop is unchanged across a re-render", async () => {
    const fetch = (async (input: string | URL | Request) =>
      okFor(
        typeof input === "string" ? input : input.toString(),
      )) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useHealthRecords(url, { fetch }),
      { initialProps: { url: "https://pod.example/health/a.ttl" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.entries;

    // Re-render with the same url (and a whitespace-padded spelling — both
    // normalise identically, so neither is treated as a change).
    rerender({ url: "https://pod.example/health/a.ttl" });
    rerender({ url: "  https://pod.example/health/a.ttl  " });
    expect(result.current.resourceUrl).toBe("https://pod.example/health/a.ttl");
    expect(result.current.entries).toBe(before);
  });

  it("refresh re-fetches the same resource", async () => {
    let count = 0;
    const fetch = (async (input: string | URL | Request) => {
      count += 1;
      return okFor(typeof input === "string" ? input : input.toString());
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useHealthRecords("https://pod.example/health/a.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(count).toBe(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(count).toBe(2));
    expect(result.current.error).toBeNull();
  });
});
