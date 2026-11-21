// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ALL_ADAPTERS } from "../registry.js";
import type { RunLimits } from "./budget.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { ConnectorState, IntegrationAdapter } from "./types.js";

const state: ConnectorState = {
  connectedAt: "2026-01-01T00:00:00Z",
  lastSync: "2026-01-01T00:00:00Z",
  cursor: "previous-checkpoint",
  lastOutcome: "success",
  counts: { documents: 7, items: 11, skipped: 0 },
};

async function capped(
  adapter: IntegrationAdapter,
  limits: Partial<RunLimits>,
  api: typeof fetch,
  cursor = adapter.metadata.id === "spotify" ? "after:0" : "",
) {
  const pod = createMemoryPod();
  const onState = vi.fn();
  const result = runImport({
    adapter,
    mode: "live",
    sourceAuth: { fetch: api },
    podWriter: createFetchPodWriter({
      adapterId: adapter.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    }),
    state,
    cursor,
    onState,
    limits,
  });
  const resource =
    limits.maxRequests !== undefined
      ? "requests"
      : limits.maxItems !== undefined
        ? "items"
        : "bytes";
  await expect(result).rejects.toMatchObject({
    name: "RunBudgetExceededError",
    adapterId: adapter.metadata.id,
    resource,
  });
  await expect(result).rejects.toThrow(
    "Partial data may have been saved; the checkpoint is unchanged.",
  );
  expect(onState).toHaveBeenCalledExactlyOnceWith({ ...state, lastOutcome: "error" });
}

describe.each(
  ALL_ADAPTERS.map((adapter) => ({ adapter, id: adapter.metadata.id })),
)("$id run budget", ({ adapter }) => {
  it("refuses the first source request at a zero request allowance", async () => {
    const api = vi.fn(fixtureFetch(adapter.metadata.id, adapter.fixtures()));
    await capped(adapter, { maxRequests: 0 }, api);
    expect(api).not.toHaveBeenCalled();
  });
  it("counts source records before mapping or buffering them", async () => {
    await capped(adapter, { maxItems: 0 }, fixtureFetch(adapter.metadata.id, adapter.fixtures()));
  });
  it("caps streamed source bytes independently of the per-response cap", async () => {
    await capped(adapter, { maxBytes: 1 }, fixtureFetch(adapter.metadata.id, adapter.fixtures()));
  });
});

describe("Gmail incremental run accounting", () => {
  const adapter = ALL_ADAPTERS.find((candidate) => candidate.metadata.id === "gmail");
  if (!adapter) throw new Error("Gmail adapter is absent from the audit");
  function historySource(body: unknown, status = 200): typeof fetch {
    return vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/profile"))
        return Response.json({ emailAddress: "synthetic@example.test", historyId: "1" });
      if (url.pathname.endsWith("/labels")) return Response.json({ labels: [] });
      return Response.json(body, { status });
    });
  }
  it.each([
    "messagesDeleted",
    "messagesAdded",
    "labelsAdded",
    "labelsRemoved",
  ])("counts nested %s entries before deduplication", async (group) => {
    await capped(
      adapter,
      { maxItems: 3 },
      historySource({ history: [{ [group]: [null, null] }], historyId: "2" }),
      "old",
    );
  });
  it("keeps the request counter when expired history falls back to a full listing", async () => {
    const api = historySource({}, 404);
    await capped(adapter, { maxRequests: 3 }, api, "old");
    expect(api).toHaveBeenCalledTimes(3);
  });
});

const paginated = new Set([
  "spotify",
  "github",
  "strava",
  "reddit",
  "discord",
  "twitch",
  "notion",
  "dropbox",
  "google-calendar",
  "google-contacts",
  "google-drive",
  "gmail",
]);

/** Distinct cursors/IDs defeat repeated-page guards. A fuse makes the pre-fix regression finite. */
function endless(adapter: IntegrationAdapter, rows: boolean): typeof fetch {
  const fallback = fixtureFetch(adapter.metadata.id, adapter.fixtures());
  let n = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    if (++n > 8) throw new Error("Hostile-service test fuse: run budget was not enforced");
    const url = new URL(String(input));
    const entries = rows ? [null, null] : [];
    let body: unknown;
    switch (adapter.metadata.id) {
      case "spotify":
        body = { items: entries, next: `${url.origin}${url.pathname}?offset=${n}` };
        break;
      case "github":
        if (url.pathname === "/user") return fallback(input, init);
        body = Array.from({ length: 100 }, (_, i) => ({ id: n * 100 + i }));
        break;
      case "strava":
        body = [{ id: n, start_date: new Date(Date.UTC(2026, 0, 20 - n)).toISOString() }];
        break;
      case "reddit":
        if (url.pathname === "/api/v1/me") return fallback(input, init);
        body = { data: { children: entries, after: `next-${n}` } };
        break;
      case "discord":
        if (url.pathname.endsWith("/users/@me")) return fallback(input, init);
        body = Array.from({ length: 200 }, (_, i) => ({ id: `${n * 200 + i}` }));
        break;
      case "twitch":
        if (url.pathname.endsWith("/users")) return fallback(input, init);
        body = { data: entries, pagination: { cursor: `next-${n}` } };
        break;
      case "notion":
        body = { results: entries, has_more: true, next_cursor: `next-${n}` };
        break;
      case "dropbox":
        body = { entries, has_more: true, cursor: `next-${n}` };
        break;
      case "google-calendar":
        body = { items: entries, nextPageToken: `next-${n}` };
        break;
      case "google-contacts":
        body = { connections: entries, nextPageToken: `next-${n}` };
        break;
      case "google-drive":
        if (url.pathname.endsWith("/startPageToken")) return fallback(input, init);
        body = { files: entries, nextPageToken: `next-${n}` };
        break;
      case "gmail":
        if (url.pathname.endsWith("/profile"))
          return Response.json({ emailAddress: "synthetic@example.test", historyId: "1" });
        if (url.pathname.endsWith("/labels")) return Response.json({ labels: [] });
        if (!url.pathname.endsWith("/messages")) return fallback(input, init);
        body = { messages: entries, nextPageToken: `next-${n}` };
        break;
      default:
        throw new Error("Missing hostile-service case");
    }
    return Response.json(body);
  });
}

describe.each(
  ALL_ADAPTERS.filter((adapter) => paginated.has(adapter.metadata.id)).map((adapter) => ({
    adapter,
    id: adapter.metadata.id,
  })),
)("$id endless pagination", ({ adapter }) => {
  it("stops before dispatching a request over the shared run cap", async () => {
    const api = endless(adapter, false);
    await capped(adapter, { maxRequests: 3 }, api);
    expect(api).toHaveBeenCalledTimes(3);
  });
  it("counts malformed and overlapping page rows too", async () => {
    await capped(adapter, { maxItems: 2 }, endless(adapter, true));
  });
  it("bounds cumulative bytes across individually small continuing pages", async () => {
    const source = endless(adapter, false);
    const api = vi.fn<typeof fetch>(async (input, init) => {
      const response = await source(input, init);
      return new Response(`${await response.text()}${" ".repeat(4096)}`);
    });
    await capped(adapter, { maxBytes: 10_000 }, api);
    expect(api.mock.calls.length).toBeGreaterThan(1);
    expect(api.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

/** These adapters intentionally read one page; hostile continuations must not start a traversal. */
const snapshotArrays: Record<string, readonly string[]> = {
  facebook: ["data"],
  fitbit: ["activities"],
  garmin: [],
  "google-photos": ["mediaItems"],
  instagram: ["data"],
  linkedin: ["elements"],
  pinterest: ["items"],
  slack: ["channels"],
  tiktok: ["data", "videos"],
  "x-twitter": ["data"],
  youtube: ["items"],
};
describe.each(
  ALL_ADAPTERS.filter((adapter) => snapshotArrays[adapter.metadata.id]).map((adapter) => ({
    adapter,
    id: adapter.metadata.id,
  })),
)("$id hostile first page", ({ adapter }) => {
  it("caps oversized record arrays even when the service advertises endless continuation", async () => {
    const source = fixtureFetch(adapter.metadata.id, adapter.fixtures());
    const api = vi.fn<typeof fetch>(async (input, init) => {
      const body = await (await source(input, init)).json();
      const path = snapshotArrays[adapter.metadata.id] ?? [];
      let parent = body;
      for (const key of path.slice(0, -1)) parent = parent?.[key];
      const key = path.at(-1);
      const records = key === undefined ? body : parent?.[key];
      if (Array.isArray(records) && records.length) {
        const expanded = Array.from({ length: 4 }, () => records[0]);
        if (key === undefined) return Response.json(expanded);
        parent[key] = expanded;
        body.nextPageToken = "endless";
        body.paging = { next: String(input) };
      }
      return Response.json(body);
    });
    await capped(adapter, { maxItems: 2 }, api);
    expect(api.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
