// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// @vitest-environment jsdom
//
// Focused tests for the data hook's behaviour against an injected store stub:
// load / open / close / error classification, the auth-seam fetch threading, and
// the race + lifecycle handling (a slow load superseded by a newer navigation
// must NOT overwrite the newer state; a read resolving after navigate-away is
// dropped). The store factory is built ONCE per test (a stable reference) — an
// inline factory in the render callback would change identity every render and
// re-trigger the store-change reset (an infinite render loop).

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createDocsStore, DocsStore, DocumentEntry, StoredDocument } from "../store.js";
import { useDocsListing } from "./useDocsListing.js";

const POD = "https://alice.pod/";
const WEBID = "https://alice.pod/profile/card#me";
const DOC_URL = "https://alice.pod/pod-docs/note-abc.ttl";

function entry(over: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    url: DOC_URL,
    name: "note-abc.ttl",
    title: "My notes",
    isContainer: false,
    modified: "2026-06-15T10:00:00.000Z",
    ...over,
  };
}

function stored(over: Partial<StoredDocument["data"]> = {}): StoredDocument {
  return {
    url: DOC_URL,
    etag: '"v1"',
    data: {
      title: "My notes",
      body: "<p>hello</p>",
      format: "text/html",
      creator: WEBID,
      created: "2026-06-15T09:00:00.000Z",
      modified: "2026-06-15T10:00:00.000Z",
      revisions: [],
      ...over,
    },
  };
}

/** An error shaped like RdfFetchError (carries a numeric `.status`). */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/**
 * A STABLE injectable `createStore`. Returns the SAME stub `DocsStore` (whose
 * `list`/`read` are the supplied functions) on every call, so the hook's
 * `useMemo`-built store keeps a stable identity across re-renders.
 */
function stableFactory(stub: {
  list: () => Promise<DocumentEntry[]>;
  read?: (url: string) => Promise<StoredDocument | undefined>;
}): typeof createDocsStore {
  const store = { read: async () => undefined, ...stub } as unknown as DocsStore;
  return (() => store) as typeof createDocsStore;
}

describe("useDocsListing — listing", () => {
  it("loads the document listing on mount", async () => {
    const list = vi.fn(async () => [entry()]);
    const createStore = stableFactory({ list });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.title).toBe("My notes");
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("surfaces an empty listing", async () => {
    const createStore = stableFactory({ list: async () => [] });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("reports a 401 as a login-flavoured access error", async () => {
    const createStore = stableFactory({
      list: async () => {
        throw httpError(401);
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(true);
    expect(result.current.error).toMatch(/log in/i);
  });

  it("reports a 403 as a permission-flavoured access error", async () => {
    const createStore = stableFactory({
      list: async () => {
        throw httpError(403);
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.isAccessError).toBe(true));
    expect(result.current.error).toMatch(/permission/i);
  });

  it("reports a generic error for a non-access failure", async () => {
    const createStore = stableFactory({
      list: async () => {
        throw new Error("network down");
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.isAccessError).toBe(false);
  });

  it("re-lists on refresh", async () => {
    const list = vi.fn(async () => [entry()]);
    const createStore = stableFactory({ list });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("useDocsListing — opening a document", () => {
  it("opens a document read-only", async () => {
    const read = vi.fn(async () => stored());
    const createStore = stableFactory({ list: async () => [entry()], read });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.openDocument).not.toBeNull());
    expect(result.current.openDocument?.data.body).toBe("<p>hello</p>");
    expect(read).toHaveBeenCalledWith(DOC_URL);
  });

  it("reports a missing document on open", async () => {
    const createStore = stableFactory({ list: async () => [entry()], read: async () => undefined });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.error).toMatch(/could not be found/i));
    expect(result.current.openDocument).toBeNull();
  });

  it("reports a 403 on open as a permission error", async () => {
    const createStore = stableFactory({
      list: async () => [entry()],
      read: async () => {
        throw httpError(403);
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.isAccessError).toBe(true));
    expect(result.current.error).toMatch(/permission/i);
  });

  it("reports a 401 on open as a login error", async () => {
    const createStore = stableFactory({
      list: async () => [entry()],
      read: async () => {
        throw httpError(401);
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.error).toMatch(/log in/i));
    expect(result.current.isAccessError).toBe(true);
  });

  it("reports a generic error on open", async () => {
    const createStore = stableFactory({
      list: async () => [entry()],
      read: async () => {
        throw new Error("read failed");
      },
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.error).toBe("read failed"));
  });

  it("closes the open document and returns to the listing", async () => {
    const createStore = stableFactory({ list: async () => [entry()], read: async () => stored() });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.openDocument).not.toBeNull());
    act(() => result.current.close());
    expect(result.current.openDocument).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("useDocsListing — auth seam + staleness", () => {
  it("threads the injected fetch into the store factory", async () => {
    const fetchStub = vi.fn() as unknown as typeof fetch;
    const spy = vi.fn(stableFactory({ list: async () => [] }));
    const createStore = spy as unknown as typeof createDocsStore;
    const { result } = renderHook(() =>
      useDocsListing(POD, WEBID, { fetch: fetchStub, createStore }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ podRoot: POD, webId: WEBID, fetchImpl: fetchStub }),
    );
  });

  it("omits fetchImpl when no fetch is injected (global-fetch fallback)", async () => {
    const spy = vi.fn(stableFactory({ list: async () => [] }));
    const createStore = spy as unknown as typeof createDocsStore;
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const arg = spy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("fetchImpl");
  });

  it("resets to the new pod's listing when the podRoot prop changes", async () => {
    // A distinct stable store per pod root, selected by the factory's podRoot arg
    // so the hook's useMemo rebuilds (new identity) on the prop change.
    const listA = vi.fn(async () => [entry({ title: "pod-a-doc" })]);
    const listB = vi.fn(async () => [entry({ title: "pod-b-doc" })]);
    const storeA = { list: listA, read: async () => undefined } as unknown as DocsStore;
    const storeB = { list: listB, read: async () => undefined } as unknown as DocsStore;
    const createStore = ((opts: { podRoot: string }) =>
      opts.podRoot === POD ? storeA : storeB) as typeof createDocsStore;

    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useDocsListing(pod, WEBID, { createStore }),
      { initialProps: { pod: POD } },
    );
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("pod-a-doc"));

    rerender({ pod: "https://bob.pod/" });
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("pod-b-doc"));
    expect(result.current.openDocument).toBeNull();
    expect(listB).toHaveBeenCalledTimes(1);
  });

  it("drops a stale listing response when a newer load supersedes it", async () => {
    // First list resolves slowly; a refresh fires a faster second list. The
    // slow first response must NOT overwrite the fast second one.
    let resolveFirst: (v: DocumentEntry[]) => void = () => {};
    const first = new Promise<DocumentEntry[]>((r) => {
      resolveFirst = r;
    });
    const list = vi
      .fn<() => Promise<DocumentEntry[]>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue([entry({ title: "fresh" })]);
    const createStore = stableFactory({ list });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    // Trigger the second (fast) load before the first resolves.
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("fresh"));
    // Now let the stale first load resolve — it must be ignored.
    act(() => resolveFirst([entry({ title: "stale" })]));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(result.current.entries[0]?.title).toBe("fresh");
  });

  it("drops a stale listing REJECTION when a newer load supersedes it", async () => {
    // First list rejects slowly; a refresh fires a faster second list that
    // succeeds. The slow first rejection must NOT surface an error over the
    // newer success (exercises the catch-path staleness guard).
    let rejectFirst: (e: unknown) => void = () => {};
    const first = new Promise<DocumentEntry[]>((_, rej) => {
      rejectFirst = rej;
    });
    const list = vi
      .fn<() => Promise<DocumentEntry[]>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue([entry({ title: "fresh" })]);
    const createStore = stableFactory({ list });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("fresh"));
    // Let the stale first load reject — it must be ignored, no error shown.
    await act(async () => {
      rejectFirst(new Error("stale failure"));
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.entries[0]?.title).toBe("fresh");
  });

  it("clears `opening` and renders the new listing when a store dep changes mid-open", async () => {
    // Regression: a `store.read()` is in flight (opening=true) when an identity
    // prop changes, rebuilding the store. The stale read is dropped by the
    // request-id guard, so its `setOpening(false)` never runs — without the
    // store-change reset clearing `opening`, the view stays stuck on the loading
    // flag (table hidden) after the new pod's listing loads. Assert: `opening`
    // is cleared, the new listing renders, and the late stale read does not flip
    // state back to the old document.
    let resolveReadA: (v: StoredDocument) => void = () => {};
    const slowReadA = new Promise<StoredDocument>((r) => {
      resolveReadA = r;
    });
    const readA = vi
      .fn<(url: string) => Promise<StoredDocument | undefined>>()
      .mockReturnValueOnce(slowReadA);
    const storeA = {
      list: async () => [entry({ title: "pod-a-doc" })],
      read: readA,
    } as unknown as DocsStore;
    const storeB = {
      list: async () => [entry({ title: "pod-b-doc" })],
      read: async () => undefined,
    } as unknown as DocsStore;
    const createStore = ((opts: { podRoot: string }) =>
      opts.podRoot === POD ? storeA : storeB) as typeof createDocsStore;

    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useDocsListing(pod, WEBID, { createStore }),
      { initialProps: { pod: POD } },
    );
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("pod-a-doc"));

    // Begin opening a document — read is now in flight (opening=true).
    act(() => result.current.open(DOC_URL));
    expect(result.current.opening).toBe(true);

    // Switch pods (store dep changes) BEFORE the read resolves.
    rerender({ pod: "https://bob.pod/" });

    // The new listing loads and `opening` is cleared (not stuck on loading).
    await waitFor(() => expect(result.current.entries[0]?.title).toBe("pod-b-doc"));
    expect(result.current.opening).toBe(false);
    expect(result.current.openDocument).toBeNull();

    // Now let the stale pod-A read resolve LATE — it must be ignored entirely:
    // no open document, `opening` stays false, listing unchanged.
    await act(async () => {
      resolveReadA(stored());
      await Promise.resolve();
    });
    expect(result.current.openDocument).toBeNull();
    expect(result.current.opening).toBe(false);
    expect(result.current.entries[0]?.title).toBe("pod-b-doc");
  });

  it("drops an open response that resolves after navigating away", async () => {
    let resolveRead: (v: StoredDocument) => void = () => {};
    const slowRead = new Promise<StoredDocument>((r) => {
      resolveRead = r;
    });
    const read = vi
      .fn<(url: string) => Promise<StoredDocument | undefined>>()
      .mockReturnValueOnce(slowRead);
    const createStore = stableFactory({ list: async () => [entry()], read });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    // Navigate away (close) before the read resolves.
    act(() => result.current.close());
    act(() => resolveRead(stored()));
    await Promise.resolve();
    expect(result.current.openDocument).toBeNull();
  });

  it("drops an open REJECTION that arrives after navigating away", async () => {
    // The open read rejects, but only after close() bumped the request id; the
    // stale catch-guard must swallow it (no error surfaced).
    let rejectRead: (e: unknown) => void = () => {};
    const slowRead = new Promise<StoredDocument>((_, rej) => {
      rejectRead = rej;
    });
    const read = vi
      .fn<(url: string) => Promise<StoredDocument | undefined>>()
      .mockReturnValueOnce(slowRead);
    const createStore = stableFactory({ list: async () => [entry()], read });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    act(() => result.current.close());
    await act(async () => {
      rejectRead(httpError(403));
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isAccessError).toBe(false);
  });
});
