// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { MAX_JSON_BYTES, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { createSpotifyAdapter, spotifyAdapter } from "./adapter.js";
import { API, spotifyJson } from "./api.js";

const json = (body: unknown) => new Response(JSON.stringify(body));

/** One item per collection/page, twelve requests and eleven items per complete import. */
function source(prefix: string, override: (url: URL) => Response | undefined = () => undefined) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const response = override(url);
    if (response) return response;
    const track = { id: `${prefix}-track`, name: "Synthetic track" };
    switch (url.pathname) {
      case "/v1/me":
        return json({ id: "synthetic-user" });
      case "/v1/me/tracks":
        return json({ items: [{ track }] });
      case "/v1/me/following":
        return json({ artists: { items: [{ id: `${prefix}-artist` }] } });
      case "/v1/me/playlists":
        return json({ items: [{ id: "synthetic-playlist", owner: { id: "synthetic-user" } }] });
      case "/v1/playlists/synthetic-playlist/items":
        return json({ items: [{ item: track }] });
      case "/v1/me/player/recently-played":
        return json({ items: [{ track, played_at: "2026-10-25T12:00:00Z" }] });
      case "/v1/me/top/tracks":
      case "/v1/me/top/artists":
        return json({ items: [track] });
      default:
        throw new Error("Unexpected synthetic source request");
    }
  });
}

async function seeded() {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: "spotify",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const report = await runImport({
    adapter: spotifyAdapter,
    mode: "live",
    podWriter,
    sourceAuth: { fetch: source("existing") },
  });
  expect(report.written).toHaveLength(10);
  const snapshots = report.written.map(({ url }) => ({ url, body: pod.get(url) }));
  expect(snapshots.some(({ body }) => body?.includes("existing-track"))).toBe(true);
  return { pod, podWriter, report, snapshots };
}

async function expectPreserved(api: typeof fetch, limits?: RunLimits, message?: string) {
  const { pod, podWriter, report, snapshots } = await seeded();
  const onState = vi.fn();
  const result = runImport({
    adapter: createSpotifyAdapter(limits),
    mode: "live",
    podWriter,
    sourceAuth: { fetch: api },
    state: report.state,
    onState,
  });
  await expect(result).rejects.toBeInstanceOf(IntegrationSyncError);
  if (message) await expect(result).rejects.toThrow(message);
  for (const { url, body } of snapshots) expect(pod.get(url)).toBe(body);
  expect(onState).toHaveBeenCalledExactlyOnceWith({ ...report.state, lastOutcome: "error" });
}

describe("Spotify source bounds", () => {
  it.each([
    "request",
    "item",
  ] as const)("bounds a continuing same-resource pagination chain by %s count", async (kind) => {
    const api = source("replacement", (url) => {
      if (url.pathname !== "/v1/me/tracks") return undefined;
      const offset = Number(url.searchParams.get("offset") ?? "0");
      return json({
        // Empty pages still consume requests; invalid entries still consume item capacity.
        items: kind === "request" ? [] : [{ track: { id: `synthetic-${offset}` } }, null],
        next: `${API}/me/tracks?limit=50&offset=${offset + 1}`,
      });
    });
    await expectPreserved(
      api,
      { maxRequests: kind === "request" ? 2 : 100, maxItems: kind === "item" ? 2 : 100 },
      `${kind} budget`,
    );
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each([
    "request",
    "item",
  ] as const)("shares the %s budget across resources, playlist contents and every history page", async (kind) => {
    const api = source("replacement", (url) =>
      url.pathname === "/v1/me/player/recently-played"
        ? json({
            items: [{ track: { id: "new-play" }, played_at: "2026-10-26T12:00:00Z" }],
            next: `${API}/me/player/recently-played?limit=50&before=1`,
          })
        : undefined,
    );
    await expectPreserved(
      api,
      { maxRequests: kind === "request" ? 12 : 100, maxItems: kind === "item" ? 11 : 100 },
      `${kind} budget`,
    );
    expect(api).toHaveBeenCalledTimes(kind === "request" ? 12 : 13);
  });

  it("counts the non-paged profile request", async () => {
    const api = source("replacement");
    await expectPreserved(api, { maxRequests: 9, maxItems: 100 }, "request budget");
    expect(api).toHaveBeenCalledTimes(9);
    expect(String(api.mock.lastCall?.[0])).toBe(`${API}/me`);
  });

  it("counts rate-limit retries before dispatching them", async () => {
    vi.useFakeTimers();
    try {
      const api = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      );
      // Fail inside a single retried page, rather than resetting its request budget.
      const outcome = expectPreserved(api, { maxRequests: 2, maxItems: 100 }, "request budget");
      await vi.runAllTimersAsync();
      await outcome;
      expect(api).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    false,
    true,
  ])("bounds cumulative streamed UTF-8 bytes before replacing collections (paginated: %s)", async (paginated) => {
    const maxBytes = 512;
    const track = { id: "replacement-track", name: "é".repeat(150) };
    const first = JSON.stringify({
      items: [{ track }],
      ...(paginated ? { next: `${API}/me/tracks?limit=50&offset=1` } : {}),
    });
    const second = JSON.stringify({ items: paginated ? [{ track }] : [track] });
    const encoder = new TextEncoder();
    const bytes = encoder.encode(second);
    // Each response fits; the combined UTF-8 data exceeds the run's capacity.
    expect(encoder.encode(first).byteLength).toBeLessThan(maxBytes);
    expect(bytes.byteLength).toBeLessThan(maxBytes);
    expect(first.length + second.length).toBeLessThan(maxBytes);
    expect(encoder.encode(first).byteLength + bytes.byteLength).toBeGreaterThan(maxBytes);
    const cancel = vi.fn();
    let offset = 0;
    const streamed = new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (offset >= bytes.byteLength) return controller.close();
            controller.enqueue(bytes.subarray(offset, offset + 64));
            offset += 64;
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    const api = source("replacement", (url) => {
      if (url.pathname === "/v1/me/tracks" && !url.searchParams.has("offset"))
        return new Response(first);
      if (url.pathname === (paginated ? "/v1/me/tracks" : "/v1/me/top/tracks")) return streamed;
      return undefined;
    });
    await expectPreserved(api, { maxRequests: 100, maxItems: 100, maxBytes }, "data budget");
    expect(api).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(offset).toBeLessThan(bytes.byteLength);
  });

  it("allows exact limits and creates a fresh budget for each run", async () => {
    const { podWriter } = await seeded();
    const fixture = source("replacement");
    let maxBytes = 0;
    const measured: typeof fetch = async (...args) => {
      const response = await fixture(...args);
      maxBytes += (await response.clone().arrayBuffer()).byteLength;
      return response;
    };
    await runImport({
      adapter: spotifyAdapter,
      mode: "live",
      podWriter,
      sourceAuth: { fetch: measured },
    });
    const limits = { maxRequests: 12, maxItems: 11, maxBytes };
    const adapter = createSpotifyAdapter(limits);
    for (let run = 0; run < 2; run++) {
      const api = source("replacement");
      const report = await runImport({
        adapter,
        mode: "live",
        podWriter,
        sourceAuth: { fetch: api },
      });
      expect(report.written).toHaveLength(10);
      expect(report.state?.lastOutcome).toBe("success");
      expect(api).toHaveBeenCalledTimes(12);
    }
    // Every response counts, including the profile, playlist contents and history.
    const api = source("replacement");
    await expectPreserved(api, { ...limits, maxBytes: maxBytes - 1 }, "data budget");
    expect(api).toHaveBeenCalledTimes(12);
    expect(String(api.mock.lastCall?.[0])).toContain("/me/player/recently-played?");
  });

  it.each([
    { declared: true, path: "/v1/me" },
    { declared: false, path: "/v1/me" },
    { declared: true, path: "/v1/me/player/recently-played" },
    { declared: false, path: "/v1/me/player/recently-played" },
  ])("caps JSON bytes for $path (declared: $declared)", async ({ declared, path }) => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(chunk);
    });
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      headers: declared ? { "content-length": String(MAX_JSON_BYTES + 1) } : undefined,
    });
    const api = source("replacement", (url) => (url.pathname === path ? response : undefined));
    await expectPreserved(api, undefined, "too large");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(declared ? 0 : MAX_JSON_BYTES / chunk.byteLength + 1);
  });

  it("maps invalid JSON through the shared bounded reader", async () => {
    await expect(spotifyJson(async () => new Response("{"), `${API}/me`)).rejects.toMatchObject({
      name: "IntegrationSyncError",
      adapterId: "spotify",
      url: `${API}/me`,
      message: expect.stringContaining("invalid JSON"),
    });
  });
});
