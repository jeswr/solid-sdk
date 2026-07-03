// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Test harness: render a component inside a `SessionContext.Provider` with a
 * STUBBED authed fetch and a MemoryKv-backed DiaryStore — no reactive-auth, no
 * server. This is the suite's "everything unit-testable with a stubbed fetch"
 * seam in action.
 */
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { DiaryStore } from "@/lib/cache/diary-store";
import { MemoryKv } from "@/lib/cache/kv";
import { resetDiaryReadyMemo } from "@/lib/pod/pod-fs";
import { anonymousSession, SessionContext, type SessionValue } from "@/lib/session/context";

/** A recorded fetch call. */
export interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface FetchMock {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
  /** URLs of PUT requests, in order (handy for ACL-written-first assertions). */
  puts: () => string[];
}

/**
 * A recording stub fetch. By default: HEAD → 200 (resource exists, skip create),
 * every other method → 200 ok. Override per-request via `handler` (return a
 * Response, or undefined to use the default).
 */
export function makeFetchMock(
  handler?: (call: FetchCall) => Response | undefined,
): FetchMock {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    const headers = (init?.headers as Record<string, string>) ?? undefined;
    const call: FetchCall = { url, method, body, headers };
    calls.push(call);
    const custom = handler?.(call);
    if (custom) return custom;
    if (method === "HEAD") return new Response(null, { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, puts: () => calls.filter((c) => c.method === "PUT").map((c) => c.url) };
}

export interface SessionHarness {
  store: DiaryStore;
  fetchMock: FetchMock;
  value: SessionValue;
}

/** Build a signed-in session value with a stubbed authed fetch + memory store. */
export function makeSession(overrides?: {
  fetchMock?: FetchMock;
  publicFetch?: typeof globalThis.fetch;
  webId?: string;
  storageRoot?: string;
}): SessionHarness {
  resetDiaryReadyMemo();
  const webId = overrides?.webId ?? "https://alice.example/profile/card#me";
  const storageRoot = overrides?.storageRoot ?? "https://alice.example/";
  const fetchMock = overrides?.fetchMock ?? makeFetchMock();
  const store = new DiaryStore(new MemoryKv(), webId);
  const value: SessionValue = {
    ...anonymousSession,
    status: "authed",
    webId,
    storageRoot,
    store,
    authedFetch: fetchMock.fetch,
    publicFetch: overrides?.publicFetch ?? fetchMock.fetch,
  };
  return { store, fetchMock, value };
}

/** Render `ui` inside a signed-in session. */
export function renderWithSession(
  ui: ReactElement,
  overrides?: Parameters<typeof makeSession>[0],
): SessionHarness & { rendered: RenderResult } {
  const harness = makeSession(overrides);
  const rendered = render(
    <SessionContext.Provider value={harness.value}>{ui}</SessionContext.Provider>,
  );
  return { ...harness, rendered };
}
