// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Test harness: render a component inside a `SessionContext.Provider` with a
 * StorageClient memory backend and a MemoryKv-backed DiaryStore. Public API
 * requests have a separate stub fetch; no server or reactive-auth is required.
 */
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { recordingStorage } from "./storage";
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
  storage: ReturnType<typeof recordingStorage>["storage"];
  calls: FetchCall[];
  /** URLs of PUT requests, in order (handy for ACL-written-first assertions). */
  puts: () => string[];
}

/**
 * SDK memory storage plus a separate recording fetch for public APIs.
 * Override public responses with `handler` (undefined uses the default).
 */
export function makeFetchMock(
  handler?: (call: FetchCall) => Response | undefined,
  root = "https://alice.example/",
): FetchMock {
  const { storage, calls } = recordingStorage(root);
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
  return { fetch, storage, calls, puts: () => calls.filter((c) => c.method === "PUT").map((c) => c.url) };
}

export interface SessionHarness {
  store: DiaryStore;
  fetchMock: FetchMock;
  value: SessionValue;
}

/** Build a signed-in session value with SDK memory storage + a memory diary cache. */
export function makeSession(overrides?: {
  fetchMock?: FetchMock;
  publicFetch?: typeof globalThis.fetch;
  webId?: string;
  storageRoot?: string;
}): SessionHarness {
  resetDiaryReadyMemo();
  const webId = overrides?.webId ?? "https://alice.example/profile/card#me";
  const storageRoot = overrides?.storageRoot ?? "https://alice.example/";
  const fetchMock = overrides?.fetchMock ?? makeFetchMock(undefined, storageRoot);
  const store = new DiaryStore(new MemoryKv(), webId);
  const value: SessionValue = {
    ...anonymousSession,
    status: "authed",
    webId,
    storageRoot,
    store,
    storage: fetchMock.storage,
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
