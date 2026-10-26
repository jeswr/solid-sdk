// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { runImport } from "../core/import-runner.js";
import { buildAuthorizationUrl } from "../core/oauth.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { ConnectorState, ImportContext, NormalisedDoc } from "../core/types.js";
import { spotifyAdapter } from "./adapter.js";
import { API, pages, spotifyJson } from "./api.js";
import { SPOTIFY_FIXTURES, TOP_TRACKS } from "./fixtures.js";
import { CORE, MEDIA, SCHEMA, TIME } from "./vocab.js";

const ROOT = `${TEST_POD_ROOT}integrations/spotify/`;
const { namedNode: nn } = DataFactory;
const TYPE = nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

function source(handler: (url: URL) => Response | undefined = () => undefined) {
  const fallback = fixtureFetch("spotify", SPOTIFY_FIXTURES);
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return handler(url) ?? fallback(input, init);
  });
}
function writer(pod = createMemoryPod()) {
  return createFetchPodWriter({
    adapterId: "spotify",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
}
async function imported(
  api = source(),
  cursor?: string,
  pod = createMemoryPod(),
  state?: ConnectorState,
) {
  const report = await runImport({
    adapter: spotifyAdapter,
    mode: "live",
    podWriter: writer(pod),
    sourceAuth: { fetch: api },
    cursor,
    state,
  });
  return { pod, report };
}
function context(api: typeof fetch): ImportContext {
  return {
    api,
    resolve: (slug) => `${ROOT}${slug}`,
    read: async () => undefined,
    write: async (doc) => ({ ...doc, url: `${ROOT}${doc.slug}` }),
    progress: () => {},
  };
}
afterEach(() => vi.useRealTimers());

describe("Spotify production import", () => {
  it("requests secretless PKCE and every read scope", () => {
    const cfg = spotifyAdapter.oauth;
    if (!cfg) throw new Error("Missing OAuth configuration");
    expect(cfg.tokenExchange).toBe("public");
    const url = new URL(
      buildAuthorizationUrl(
        { ...cfg, clientId: "fixture-client" },
        {
          state: "fixture-state",
          challenge: "fixture-challenge",
          redirectUri: "https://app.test/callback",
        },
      ),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "user-top-read",
      "playlist-read-private",
      "playlist-read-collaborative",
      "user-library-read",
      "user-follow-read",
      "user-read-recently-played",
    ]);
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("paginates saved tracks, playlists/items, followed artists and both top kinds in three ranges", async () => {
    const api = source((url) => {
      const path = url.pathname;
      const second = url.searchParams.has("offset") || url.searchParams.has("after");
      const next = new URL(url);
      next.searchParams.set(path === "/v1/me/following" ? "after" : "offset", "2");
      const page = {
        items: [{ id: second ? "second" : "first", name: "Synthetic" }],
        next: second ? null : next.href,
      };
      if (path === "/v1/me/tracks") return json({ ...page, items: [{ track: page.items[0] }] });
      if (path === "/v1/me/playlists") return json(page);
      if (path.endsWith("/items"))
        return json({ ...page, items: [{ item: TOP_TRACKS.items?.[0] }] });
      if (path === "/v1/me/following") return json({ artists: page });
      if (path.startsWith("/v1/me/top/")) return json(page);
      return undefined;
    });
    const { pod, report } = await imported(api);
    expect(report.written).toHaveLength(10);
    for (const slug of [
      "saved-tracks",
      "top-tracks",
      "top-tracks-short_term",
      "top-tracks-long_term",
    ])
      expect(pod.get(`${ROOT}music/${slug}.ttl`)).toContain('"second"');
    expect(pod.get(`${ROOT}music/followed-artists.ttl`)).toContain('"second"');
    const playlist = pod.dataset(`${ROOT}music/playlists.ttl`);
    expect(playlist.getQuads(null, nn(`${SCHEMA}itemListElement`), null, null)).toHaveLength(4);
    expect(
      playlist
        .getQuads(null, nn(`${SCHEMA}position`), null, null)
        .map((q) => q.object.value)
        .sort(),
    ).toEqual(["1", "1", "2", "2"]);
    for (const kind of ["tracks", "artists"]) {
      const ranges = api.mock.calls
        .map(([input]) => new URL(String(input)))
        .filter((url) => url.pathname === `/v1/me/top/${kind}` && !url.searchParams.has("offset"))
        .map((url) => url.searchParams.get("time_range"));
      expect(ranges).toEqual(["short_term", "medium_term", "long_term"]);
    }
  });

  it("follows recently-played before pagination, persists after, and merges increments without duplication", async () => {
    const firstTime = Date.parse("2026-10-25T12:00:00Z");
    const secondTime = firstTime + 1000;
    const historyUrl = `${API}/me/player/recently-played`;
    const api = source((url) => {
      if (url.pathname !== "/v1/me/player/recently-played") return undefined;
      if (url.searchParams.has("before"))
        return json({
          items: [{ track: TOP_TRACKS.items?.[0], played_at: new Date(firstTime).toISOString() }],
        });
      return json({
        items: [{ track: TOP_TRACKS.items?.[0], played_at: new Date(secondTime).toISOString() }],
        next: `${historyUrl}?limit=50&before=${secondTime}`,
      });
    });
    const { pod, report } = await imported(api);
    expect(report.cursor).toBe(`after:${secondTime}`);
    const nextApi = source((url) => {
      if (url.pathname !== "/v1/me/player/recently-played") return undefined;
      expect(url.searchParams.get("after")).toBe(String(secondTime));
      expect(url.searchParams.has("before")).toBe(false);
      return json({
        items: [
          { track: TOP_TRACKS.items?.[0], played_at: new Date(secondTime + 1000).toISOString() },
        ],
      });
    });
    const next = await imported(nextApi, undefined, pod, report.state);
    await imported(nextApi, report.cursor, pod);
    const ds = pod.dataset(`${ROOT}music/recently-played.ttl`);
    expect(ds.getQuads(null, TYPE, nn(`${MEDIA}PlaybackEvent`), null)).toHaveLength(3);
    expect(next.report.cursor).toBe(`after:${secondTime + 1000}`);
    const empty = source((url) =>
      url.pathname.endsWith("recently-played") ? json({ items: [] }) : undefined,
    );
    expect((await imported(empty, next.report.cursor, pod)).report.cursor).toBe(next.report.cursor);
    expect(
      pod
        .dataset(`${ROOT}music/recently-played.ttl`)
        .getQuads(null, TYPE, nn(`${MEDIA}PlaybackEvent`), null),
    ).toHaveLength(3);
  });

  it("accepts an explicit before cursor, skips malformed plays and retains checkpoint on failure", async () => {
    const api = source((url) => {
      if (!url.pathname.endsWith("recently-played")) return undefined;
      expect(url.searchParams.get("before")).toBe("1000");
      return json({
        items: [null, { played_at: "bad" }, { played_at: "2026-10-25", track: null }],
      });
    });
    const { report } = await imported(api, "before:1000");
    expect(report.skipped).toBe(3);
    expect(report.cursor).toBe("before:1000");
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: spotifyAdapter,
        mode: "live",
        podWriter: writer(),
        state: report.state,
        onState,
        sourceAuth: {
          fetch: source((url) =>
            url.pathname.endsWith("recently-played") ? json({}, 503) : undefined,
          ),
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(onState.mock.calls[0]?.[0]).toMatchObject({
      cursor: "before:1000",
      lastOutcome: "error",
    });
    await expect(imported(source(), "bad cursor")).rejects.toThrow("Invalid Spotify");
  });

  it("emits the federation/solid-listening PlaybackEvent shape without inventing listening duration", async () => {
    const { pod } = await imported();
    const ds = pod.dataset(`${ROOT}music/recently-played.ttl`);
    const events = ds.getQuads(null, TYPE, nn(`${MEDIA}PlaybackEvent`), null);
    expect(events).toHaveLength(1);
    for (const { subject } of events) {
      const work = ds.getQuads(subject, nn(`${MEDIA}playedWork`), null, null);
      expect(work).toHaveLength(1);
      expect(work[0]?.object.termType).toBe("NamedNode");
      expect(ds.getQuads(work[0]?.object, TYPE, nn(`${MEDIA}Track`), null)).toHaveLength(1);
      const atTime = ds.getQuads(subject, nn(`${CORE}atTime`), null, null);
      expect(atTime).toHaveLength(1);
      expect(atTime[0]?.object.termType).toBe("NamedNode");
      expect(ds.getQuads(atTime[0]?.object, TYPE, nn(`${TIME}Instant`), null)).toHaveLength(1);
      const instant = ds.getQuads(atTime[0]?.object, nn(`${TIME}inXSDDateTime`), null, null)[0]
        ?.object;
      expect(instant).toMatchObject({
        termType: "Literal",
        datatype: nn("http://www.w3.org/2001/XMLSchema#dateTime"),
      });
      expect(ds.getQuads(subject, nn(`${MEDIA}msPlayed`), null, null)).toHaveLength(0);
    }
  });

  it("snapshots sorted Turtle mapping for playlists and listening history", async () => {
    const docs: NormalisedDoc[] = [];
    await spotifyAdapter.import({
      ...context(source()),
      write: async (doc) => {
        docs.push(spotifyAdapter.vocabMap?.(doc) ?? doc);
        return { ...doc, url: `${ROOT}${doc.slug}` };
      },
    });
    const mapped = ["# AUTHORED-BY Codex GPT-6.1-Sol"];
    for (const doc of docs.filter((doc) =>
      ["music/playlists.ttl", "music/recently-played.ttl"].includes(doc.slug),
    ))
      mapped.push(`# ${doc.slug}\n${await sortedTurtle(doc.dataset)}`);
    await expect(mapped.join("\n")).toMatchFileSnapshot("./__snapshots__/mapping.ttl");
  });
});

describe("Spotify API failures", () => {
  it.each(["2", "Sun, 25 Oct 2026 12:00:02 GMT"])("honours Retry-After %s", async (retryAfter) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    const api = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": retryAfter }))
      .mockResolvedValueOnce(json({ items: [] }));
    const promise = spotifyJson(api, `${API}/me/tracks`);
    await vi.advanceTimersByTimeAsync(1999);
    expect(api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toEqual({ items: [] });
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("bounds retries and surfaces malformed Retry-After", async () => {
    vi.useFakeTimers();
    const api = vi.fn<typeof fetch>(async () => json({}, 429, { "retry-after": "0" }));
    const outcome = expect(spotifyJson(api, `${API}/me/tracks`)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    await vi.runAllTimersAsync();
    await outcome;
    expect(api).toHaveBeenCalledTimes(4);
    for (const header of [undefined, "garbage", "-1", "0.5", "999999999999"])
      await expect(
        spotifyJson(
          async () => json({}, 429, header ? { "retry-after": header } : {}),
          `${API}/me/tracks`,
        ),
      ).rejects.toBeInstanceOf(RateLimitedError);
  });
  it.each([401, 403, 500, 503])("surfaces %s without unbounded retries", async (status) => {
    const api = vi.fn<typeof fetch>(async () => json({}, status));
    await expect(spotifyJson(api, `${API}/me/tracks`)).rejects.toMatchObject({ status });
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://evil.test/v1/me/tracks",
    `${API}/me/playlists`,
    `${API}/me/tracks?limit=50`,
    "https://user:pass@api.spotify.com/v1/me/tracks",
    `${API}/me/tracks#fragment`,
  ])("refuses unsafe or repeated pagination %s", async (next) => {
    const api = vi.fn<typeof fetch>(async () => json({ items: [], next }));
    await expect(
      (async () => {
        for await (const _page of pages(context(api), `${API}/me/tracks?limit=50`)) {
          /* drain */
        }
      })(),
    ).rejects.toBeInstanceOf(IntegrationSyncError);
    expect(api).toHaveBeenCalledTimes(1);
  });
});

async function sortedTurtle(dataset: DatasetCore): Promise<string> {
  const store = new Store([...dataset]);
  const lines = await new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
  // N-Triples is a Turtle subset; canonical order makes mapping diffs stable.
  return `${lines.trim().split("\n").sort().join("\n")}\n`;
}
