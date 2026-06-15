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
  create?: (
    input: { title: string; body?: string },
    slugHint?: string,
  ) => Promise<{ url: string; etag: string | null }>;
  save?: (url: string, input: unknown, etag?: string | null) => Promise<{ etag: string | null }>;
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

describe("useDocsListing — createDocument (optimistic)", () => {
  const NewUrl = "https://alice.pod/pod-docs/my-doc-abc.ttl";

  it("inserts the new doc optimistically, persists, then marks Saved and opens it", async () => {
    let resolveCreate: (v: { url: string; etag: string | null }) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<{ url: string; etag: string | null }>((r) => {
          resolveCreate = r;
        }),
    );
    const createStore = stableFactory({ list: async () => [], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Fire the create — the placeholder must appear IMMEDIATELY, before persist.
    act(() => {
      void result.current.createDocument({ title: "My Doc", body: "<p>hi</p>" });
    });
    expect(result.current.saveStatus).toBe("saving");
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.title).toBe("My Doc");
    expect(create).toHaveBeenCalledWith({ title: "My Doc", body: "<p>hi</p>" });

    // Persist resolves → placeholder swapped for the real URL, Saved, opened.
    await act(async () => {
      resolveCreate({ url: NewUrl, etag: 'W/"new"' });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.saveStatus).toBe("saved"));
    expect(result.current.entries[0]?.url).toBe(NewUrl);
    expect(result.current.openDocument?.url).toBe(NewUrl);
    expect(result.current.openDocument?.data.body).toBe("<p>hi</p>");
    expect(result.current.openDocument?.etag).toBe('W/"new"');
  });

  it("reverts the optimistic insert and surfaces the error on create failure", async () => {
    const create = vi.fn(async () => {
      throw new Error("disk full");
    });
    const createStore = stableFactory({ list: async () => [entry()], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => {
      await result.current.createDocument({ title: "Doomed", body: "x" });
    });
    // Reverted: the placeholder is gone, only the original listing remains.
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.title).toBe("My notes");
    expect(result.current.saveStatus).toBe("failed");
    expect(result.current.saveError).toBe("disk full");
    expect(result.current.openDocument).toBeNull();
  });

  it("rejects an all-blank create with a validation message and no I/O", async () => {
    const create = vi.fn(async () => ({ url: NewUrl, etag: null }));
    const createStore = stableFactory({ list: async () => [], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createDocument({ title: "   ", body: "  " });
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("failed");
    expect(result.current.saveError).toMatch(/title or some content/i);
    expect(result.current.entries).toHaveLength(0);
  });

  it("surfaces a 403 on create as a permission-flavoured save error", async () => {
    const create = vi.fn(async () => {
      throw httpError(403);
    });
    const createStore = stableFactory({ list: async () => [], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createDocument({ title: "Doc", body: "b" });
    });
    expect(result.current.isSaveAccessError).toBe(true);
    expect(result.current.saveError).toMatch(/permission/i);
  });

  it("surfaces a 401 on create as a login-flavoured save error", async () => {
    const create = vi.fn(async () => {
      throw httpError(401);
    });
    const createStore = stableFactory({ list: async () => [], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createDocument({ title: "Doc", body: "b" });
    });
    expect(result.current.isSaveAccessError).toBe(true);
    expect(result.current.saveError).toMatch(/log in/i);
  });

  it("uses the URL-tail name for a body-only (untitled) optimistic create", async () => {
    const create = vi.fn(async () => ({ url: NewUrl, etag: null }));
    const createStore = stableFactory({ list: async () => [], create });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createDocument({ title: "", body: "just a body" });
    });
    expect(result.current.entries[0]?.url).toBe(NewUrl);
    expect(result.current.entries[0]?.name).toBe("my-doc-abc.ttl");
  });
});

describe("useDocsListing — saveOpenDocument (optimistic)", () => {
  function openedStore(
    save: (url: string, input: unknown, etag?: string | null) => Promise<{ etag: string | null }>,
  ): typeof createDocsStore {
    return stableFactory({ list: async () => [entry()], read: async () => stored(), save });
  }

  async function withOpenDoc(createStore: typeof createDocsStore) {
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.openDocument).not.toBeNull());
    return result;
  }

  it("updates the body optimistically, persists, and commits the new etag + Saved", async () => {
    let resolveSave: (v: { etag: string | null }) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<{ etag: string | null }>((r) => {
          resolveSave = r;
        }),
    );
    const result = await withOpenDoc(openedStore(save));

    act(() => {
      void result.current.saveOpenDocument("<p>edited</p>");
    });
    // Optimistic: the open body updates immediately, status is saving.
    expect(result.current.openDocument?.data.body).toBe("<p>edited</p>");
    expect(result.current.saveStatus).toBe("saving");
    expect(save).toHaveBeenCalledWith(
      DOC_URL,
      expect.objectContaining({ title: "My notes", body: "<p>edited</p>" }),
      '"v1"',
    );

    await act(async () => {
      resolveSave({ etag: '"v2"' });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.saveStatus).toBe("saved"));
    expect(result.current.openDocument?.etag).toBe('"v2"');
    expect(result.current.openDocument?.data.body).toBe("<p>edited</p>");
  });

  it("reverts the body and surfaces the error on save failure", async () => {
    const save = vi.fn(async () => {
      throw httpError(412); // a concurrent-edit clobber guard
    });
    const result = await withOpenDoc(openedStore(save));

    await act(async () => {
      await result.current.saveOpenDocument("<p>edited</p>");
    });
    // Reverted to the persisted body; generic error (412 is not 401/403).
    expect(result.current.openDocument?.data.body).toBe("<p>hello</p>");
    expect(result.current.saveStatus).toBe("failed");
    expect(result.current.isSaveAccessError).toBe(false);
    expect(result.current.saveError).toMatch(/412/);
  });

  it("surfaces a 403 on save as a permission-flavoured error", async () => {
    const save = vi.fn(async () => {
      throw httpError(403);
    });
    const result = await withOpenDoc(openedStore(save));
    await act(async () => {
      await result.current.saveOpenDocument("<p>edited</p>");
    });
    expect(result.current.isSaveAccessError).toBe(true);
    expect(result.current.saveError).toMatch(/permission/i);
  });

  it("is a no-op when no document is open", async () => {
    const save = vi.fn(async () => ({ etag: '"v2"' }));
    const createStore = stableFactory({ list: async () => [entry()], save: save as never });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveOpenDocument("nothing open");
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("idle");
  });

  it("ignores a save result that resolves after navigating to another resource", async () => {
    let resolveSave: (v: { etag: string | null }) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<{ etag: string | null }>((r) => {
          resolveSave = r;
        }),
    );
    const result = await withOpenDoc(openedStore(save));
    act(() => {
      void result.current.saveOpenDocument("<p>edited</p>");
    });
    // Navigate away (close) before the save resolves.
    act(() => result.current.close());
    await act(async () => {
      resolveSave({ etag: '"v2"' });
      await Promise.resolve();
    });
    // The late save must NOT resurrect the closed document.
    expect(result.current.openDocument).toBeNull();
  });

  it("discards a superseded save's result when an older save resolves last (no lost update)", async () => {
    // Overlapping saves to the SAME open document. The user edits + saves
    // ("first body"), then edits + saves again ("second body") before the
    // first save resolves. The FIRST (older) save resolves LAST: its result
    // (body + etag) must be discarded — the newer save's body and etag win, so
    // there is no lost update and the next If-Match is not desync'd.
    const resolvers: Array<(v: { etag: string | null }) => void> = [];
    const save = vi.fn(
      () =>
        new Promise<{ etag: string | null }>((r) => {
          resolvers.push(r);
        }),
    );
    const result = await withOpenDoc(openedStore(save));

    // First save (in flight).
    act(() => {
      void result.current.saveOpenDocument("<p>first</p>");
    });
    expect(result.current.openDocument?.data.body).toBe("<p>first</p>");

    // Second save before the first resolves — newer body becomes optimistic.
    act(() => {
      void result.current.saveOpenDocument("<p>second</p>");
    });
    expect(result.current.openDocument?.data.body).toBe("<p>second</p>");
    expect(save).toHaveBeenCalledTimes(2);

    // The SECOND (latest) save resolves first → its etag commits and the body
    // is the newer body.
    await act(async () => {
      resolvers[1]?.({ etag: '"v-second"' });
      await Promise.resolve();
    });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.openDocument?.etag).toBe('"v-second"');
    expect(result.current.openDocument?.data.body).toBe("<p>second</p>");

    // Now the FIRST (older, superseded) save resolves LAST — its result must be
    // discarded: the etag must NOT regress to the stale value and the body must
    // stay the newer body (no lost update / etag desync).
    await act(async () => {
      resolvers[0]?.({ etag: '"v-first"' });
      await Promise.resolve();
    });
    expect(result.current.openDocument?.etag).toBe('"v-second"');
    expect(result.current.openDocument?.data.body).toBe("<p>second</p>");
    expect(result.current.saveStatus).toBe("saved");
  });

  it("ignores a superseded save's late FAILURE (the newer save's body stands)", async () => {
    // Same overlap, but the older save REJECTS late. Its failure must not flip
    // the indicator to "failed" nor revert the newer optimistic body — the
    // latest save owns the state.
    const calls: Array<{
      resolve: (v: { etag: string | null }) => void;
      reject: (e: unknown) => void;
    }> = [];
    const save = vi.fn(
      () =>
        new Promise<{ etag: string | null }>((resolve, reject) => {
          calls.push({ resolve, reject });
        }),
    );
    const result = await withOpenDoc(openedStore(save));

    act(() => {
      void result.current.saveOpenDocument("<p>first</p>");
    });
    act(() => {
      void result.current.saveOpenDocument("<p>second</p>");
    });

    // Latest save succeeds.
    await act(async () => {
      calls[1]?.resolve({ etag: '"v-second"' });
      await Promise.resolve();
    });
    expect(result.current.saveStatus).toBe("saved");

    // Superseded older save fails LATE — must be swallowed.
    await act(async () => {
      calls[0]?.reject(httpError(412));
      await Promise.resolve();
    });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.saveError).toBeNull();
    expect(result.current.openDocument?.data.body).toBe("<p>second</p>");
    expect(result.current.openDocument?.etag).toBe('"v-second"');
  });

  it("does not revert another open document when a stale save REJECTS", async () => {
    // Save the first doc, then open a SECOND doc before the save rejects: the
    // late failure's revert must target only the original resource (now not
    // open), never clobber the currently-open second document's body.
    const doc2Url = "https://alice.pod/pod-docs/other-xyz.ttl";
    let rejectSave: (e: unknown) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<{ etag: string | null }>((_, rej) => {
          rejectSave = rej;
        }),
    );
    // The shared `stored()` helper hardcodes DOC_URL; build the second doc with
    // its own url so opening it actually switches the open resource.
    const doc2: StoredDocument = {
      url: doc2Url,
      etag: '"o1"',
      data: { ...stored().data, title: "Other", body: "<p>other</p>" },
    };
    const createStore = stableFactory({
      list: async () => [entry(), entry({ url: doc2Url, title: "Other" })],
      read: async (url: string) => (url === doc2Url ? doc2 : stored({ body: "<p>hello</p>" })),
      save,
    });
    const { result } = renderHook(() => useDocsListing(POD, WEBID, { createStore }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.open(DOC_URL));
    await waitFor(() => expect(result.current.openDocument?.url).toBe(DOC_URL));
    act(() => {
      void result.current.saveOpenDocument("<p>edited</p>");
    });
    // Open a different document before the save settles.
    act(() => result.current.open(doc2Url));
    await waitFor(() => expect(result.current.openDocument?.url).toBe(doc2Url));

    await act(async () => {
      rejectSave(new Error("late failure"));
      await Promise.resolve();
    });
    // The second document is untouched by the first doc's stale rejection.
    expect(result.current.openDocument?.url).toBe(doc2Url);
    expect(result.current.openDocument?.data.title).toBe("Other");
  });
});
