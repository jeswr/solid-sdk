// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8
//
// Focused tests for the inbox hook's race + lifecycle handling that the
// component test can't deterministically force: a slow load superseded by a
// newer mailbox prop must NOT overwrite the newer state; an aborted/late
// rejection must not surface an error; a mailbox-prop change resets the
// selection; and a selected message that vanishes after a refresh resolves to
// the list, not a blank pane.

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInbox } from "../../src/ui/useInbox.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const M1 = "https://pod.example/mail/messages/m1.ttl#it";
const M2 = "https://pod.example/mail/messages/m2.ttl#it";

/** A mailbox document with two messages dated 2026-06-10 and 2026-06-12. */
const TWO = `
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${M1}> a schema:EmailMessage ;
  schema:headline "Older" ;
  schema:sender <https://alice.example/profile/card#me> ;
  schema:dateSent "2026-06-10T09:00:00Z"^^xsd:dateTime .
<${M2}> a schema:EmailMessage ;
  schema:headline "Newer" ;
  schema:sender <https://bob.example/profile/card#me> ;
  schema:dateSent "2026-06-12T09:00:00Z"^^xsd:dateTime .
`;

/** A 200 Turtle Response for a given URL + body. */
function ttlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/turtle" },
  });
}

/** A fetch that returns the given Turtle for any URL. */
function bodyFetch(body: string): typeof globalThis.fetch {
  return (async () => ttlResponse(body)) as unknown as typeof globalThis.fetch;
}

describe("useInbox", () => {
  it("loads a mailbox on mount and sorts messages newest-first", async () => {
    const { result } = renderHook(() =>
      useInbox("https://pod.example/mail/folders/inbox.ttl", { fetch: bodyFetch(TWO) }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.messages.map((m) => m.subject)).toEqual(["Newer", "Older"]);
    expect(result.current.selected).toBeNull();
  });

  it("opens a message and returns to the list", async () => {
    const { result } = renderHook(() =>
      useInbox("https://pod.example/mail/folders/inbox.ttl", { fetch: bodyFetch(TWO) }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select(M1));
    expect(result.current.selectedId).toBe(M1);
    expect(result.current.selected?.subject).toBe("Older");
    act(() => result.current.back());
    expect(result.current.selected).toBeNull();
  });

  it("does not let a slow superseded load overwrite a newer mailbox", async () => {
    // The FIRST mailbox load hangs; switching to /fast resolves immediately.
    // When the slow one finally resolves it must be discarded as stale.
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/mail/slow.ttl") {
        await slow;
        return ttlResponse(`
@prefix schema: <http://schema.org/> .
<https://slow.example#it> a schema:EmailMessage ; schema:headline "SLOW" .
`);
      }
      return ttlResponse(TWO);
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useInbox(url, { fetch }),
      { initialProps: { url: "https://pod.example/mail/slow.ttl" } },
    );
    // Switch mailbox before the slow load resolves.
    rerender({ url: "https://pod.example/mail/fast.ttl" });
    await waitFor(() => expect(result.current.messages.map((m) => m.subject)).toContain("Newer"));

    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The stale SLOW load did NOT replace the fast mailbox's messages.
    expect(result.current.messages.map((m) => m.subject)).not.toContain("SLOW");
  });

  it("discards a superseded load that REJECTS after a newer mailbox", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/mail/slow.ttl") {
        await slow;
        throw new TypeError("slow load failed late");
      }
      return ttlResponse(TWO);
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useInbox(url, { fetch }),
      { initialProps: { url: "https://pod.example/mail/slow.ttl" } },
    );
    rerender({ url: "https://pod.example/mail/fast.ttl" });
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(0));

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The late rejection of the stale slow load did NOT set an error.
    expect(result.current.error).toBeNull();
  });

  it("surfaces a generic error for a non-access failure", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useInbox("https://pod.example/mail/inbox.ttl", { fetch }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(false);
  });

  it("resets the selection when the mailbox prop changes", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useInbox(url, { fetch: bodyFetch(TWO) }),
      { initialProps: { url: "https://pod.example/mail/folders/inbox.ttl" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select(M1));
    expect(result.current.selectedId).toBe(M1);

    rerender({ url: "https://pod.example/mail/folders/sent.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedId).toBeNull();
    expect(result.current.selected).toBeNull();
  });

  it("does NOT reset when the mailbox prop is unchanged across a re-render", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useInbox(url, { fetch: bodyFetch(TWO) }),
      { initialProps: { url: "https://pod.example/mail/folders/inbox.ttl" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select(M1));

    rerender({ url: "https://pod.example/mail/folders/inbox.ttl" });
    expect(result.current.selectedId).toBe(M1);
  });

  it("resets cleanly under StrictMode's double render of a mailbox change", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useInbox(url, { fetch: bodyFetch(TWO) }),
      {
        initialProps: { url: "https://pod.example/mail/folders/inbox.ttl" },
        wrapper: StrictMode,
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select(M1));

    rerender({ url: "https://pod.example/mail/folders/sent.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedId).toBeNull();

    act(() => result.current.select(M2));
    rerender({ url: "https://pod.example/mail/folders/archive.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedId).toBeNull();
  });

  it("resolves a selection to null when the selected id is gone after refresh", async () => {
    // First load has M1; after refresh the mailbox is empty, so the open
    // message must fall back to the list (selected === null) — not a blank pane.
    let empty = false;
    const fetch = (async () => {
      if (empty) {
        return ttlResponse(`@prefix schema: <http://schema.org/> .`);
      }
      return ttlResponse(TWO);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useInbox("https://pod.example/mail/inbox.ttl", { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select(M1));
    expect(result.current.selected?.subject).toBe("Older");

    empty = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.messages).toHaveLength(0));
    // selectedId is still M1, but it no longer exists → selected resolves null.
    expect(result.current.selectedId).toBe(M1);
    expect(result.current.selected).toBeNull();
  });

  it("falls back to globalThis.fetch when no fetch is given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ttlResponse(TWO)),
    );
    const { result } = renderHook(() => useInbox("https://pod.example/mail/inbox.ttl"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toHaveLength(2);
  });

  it("sorts dated messages before undated ones (exercises every comparator branch)", async () => {
    // Two undated + one dated message exercise every branch of the newest-first
    // comparator: dated-vs-dated is unused here, but dated-vs-undated (both
    // orderings, since the store yields them in an arbitrary order) and
    // undated-vs-undated (the `0` case) all run.
    const D1 = "https://pod.example/mail/messages/d1.ttl#it";
    const N1 = "https://pod.example/mail/messages/n1.ttl#it";
    const N2 = "https://pod.example/mail/messages/n2.ttl#it";
    const MIXED = `
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${N1}> a schema:EmailMessage ; schema:headline "Undated A" .
<${D1}> a schema:EmailMessage ; schema:headline "Dated" ;
  schema:dateSent "2026-06-11T09:00:00Z"^^xsd:dateTime .
<${N2}> a schema:EmailMessage ; schema:headline "Undated B" .
`;
    const { result } = renderHook(() =>
      useInbox("https://pod.example/mail/inbox.ttl", { fetch: bodyFetch(MIXED) }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subjects = result.current.messages.map((m) => m.subject);
    // The dated message floats to the top; both undated ones follow it.
    expect(subjects[0]).toBe("Dated");
    expect(subjects.slice(1).sort()).toEqual(["Undated A", "Undated B"]);
  });
});
