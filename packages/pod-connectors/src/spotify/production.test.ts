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
import { MusicPlaylist } from "../core/vocab.js";
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
      if (path === "/v1/me/playlists")
        return json({ ...page, items: [{ ...page.items[0], owner: { id: "fixture-user" } }] });
      if (path.endsWith("/items")) {
        expect(url.searchParams.get("additional_types")).toBe("track,episode");
        return json({ ...page, items: [{ item: TOP_TRACKS.items?.[0] }] });
      }
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

  it("retains podcast playlist items and reports unavailable/local/unknown items", async () => {
    const api = source((url) => {
      if (url.pathname === "/v1/me/playlists")
        return json({ items: [{ id: "mixed", name: "Mixed", collaborative: true }] });
      if (url.pathname === "/v1/playlists/mixed/items") {
        expect(url.searchParams.get("additional_types")).toBe("track,episode");
        return json({
          items: [
            {
              item: {
                id: "episode1",
                type: "episode",
                name: "Synthetic episode",
                duration_ms: 60000,
              },
            },
            { track: TOP_TRACKS.items?.[0] },
            null,
            { item: { id: "local1", is_local: true } },
            { item: { id: "unknown1", type: "unknown" } },
          ],
        });
      }
      return undefined;
    });
    const { pod, report } = await imported(api);
    const ds = pod.dataset(`${ROOT}music/playlists.ttl`);
    const episode = nn(`${ROOT}music/playlists.ttl#episode-episode1`);
    expect(ds.getQuads(episode, TYPE, nn(`${MEDIA}PodcastEpisode`), null)).toHaveLength(1);
    expect(ds.getQuads(episode, TYPE, nn(`${SCHEMA}PodcastEpisode`), null)).toHaveLength(1);
    expect(ds.getQuads(episode, TYPE, nn(`${SCHEMA}MusicRecording`), null)).toHaveLength(0);
    expect(
      ds.getQuads(
        episode,
        nn(`${SCHEMA}url`),
        nn("https://open.spotify.com/episode/episode1"),
        null,
      ),
    ).toHaveLength(1);
    expect(ds.getQuads(null, nn(`${SCHEMA}itemListElement`), null, null)).toHaveLength(2);
    expect(report.skipped).toBe(3);
  });

  it("retains followed playlist metadata and fetches only owned or collaborative contents", async () => {
    const api = source((url) => {
      if (url.pathname === "/v1/me/playlists")
        return json({
          items: [
            {
              id: "followed",
              name: "Synthetic followed playlist",
              description: "Metadata remains available",
              owner: { id: "fixture-other-user" },
              collaborative: false,
              items: { total: 12 },
            },
            { id: "owned", owner: { id: "fixture-user" }, collaborative: false },
            { id: "collaborative", owner: { id: "fixture-other-user" }, collaborative: true },
            { id: "unknown-owner" },
          ],
        });
      if (url.pathname.startsWith("/v1/playlists/"))
        return json({ items: [{ item: { id: "synthetic-track", type: "track" } }] });
      return undefined;
    });
    const { pod, report } = await imported(api, "after:1000");
    const playlistUrl = `${ROOT}music/playlists.ttl`;
    const ds = pod.dataset(playlistUrl);
    const followed = new MusicPlaylist(`${playlistUrl}#playlist-followed`, ds, DataFactory);
    expect(followed.name).toBe("Synthetic followed playlist");
    expect(followed.description).toBe("Metadata remains available");
    expect(followed.numTracks).toBe(12);
    expect(followed.sourceUrl).toBe("https://open.spotify.com/playlist/followed");
    expect(
      ds.getQuads(
        nn(`${playlistUrl}#playlist-followed`),
        nn(`${SCHEMA}itemListElement`),
        null,
        null,
      ),
    ).toHaveLength(0);
    expect(ds.getQuads(null, nn(`${SCHEMA}itemListElement`), null, null)).toHaveLength(2);
    expect(
      api.mock.calls
        .map(([input]) => new URL(String(input)).pathname)
        .filter((path) => path.startsWith("/v1/playlists/")),
    ).toEqual(["/v1/playlists/owned/items", "/v1/playlists/collaborative/items"]);
    expect(report.skipped).toBe(2);
    expect(report.written).toHaveLength(10);
    expect(report.cursor).toBe(`after:${Date.parse("2026-10-25T12:00:00Z")}`);
    expect(report.state).toMatchObject({
      cursor: report.cursor,
      lastOutcome: "success",
      counts: { documents: 10, skipped: 2 },
    });
    expect(
      pod
        .dataset(`${ROOT}music/recently-played.ttl`)
        .getQuads(null, TYPE, nn(`${MEDIA}PlaybackEvent`), null),
    ).toHaveLength(1);
  });

  it("requires a known current user id before treating a playlist as owned", async () => {
    const api = source((url) => {
      if (url.pathname === "/v1/me") return json({});
      if (url.pathname === "/v1/me/playlists")
        return json({
          items: [{ id: "unknown-owner" }, { id: "owned", owner: { id: "fixture-user" } }],
        });
      return undefined;
    });
    const { report } = await imported(api);
    expect(report.skipped).toBe(2);
    expect(
      api.mock.calls.some(([input]) =>
        new URL(String(input)).pathname.startsWith("/v1/playlists/"),
      ),
    ).toBe(false);
  });

  it.each([
    [403, false],
    [404, false],
    [403, true],
    [404, true],
  ])("retains metadata and continues after item status %s (later page: %s)", async (status, laterPage) => {
    const api = source((url) => {
      if (url.pathname === "/v1/me/playlists")
        return json({
          items: [
            {
              id: "inaccessible",
              name: "Synthetic restricted playlist",
              owner: { id: "fixture-user" },
              items: { total: 7 },
            },
            { id: "available", collaborative: true },
          ],
        });
      if (url.pathname === "/v1/playlists/inaccessible/items") {
        if (laterPage && !url.searchParams.has("offset")) {
          const next = new URL(url);
          next.searchParams.set("offset", "1");
          return json({
            items: [{ item: { id: "partial-work", type: "track" } }],
            next: next.href,
          });
        }
        return json({}, status);
      }
      if (url.pathname === "/v1/playlists/available/items")
        return json({ items: [{ item: { id: "available-work", type: "track" } }] });
      return undefined;
    });
    const { pod, report } = await imported(api, "after:1000");
    const playlistUrl = `${ROOT}music/playlists.ttl`;
    const ds = pod.dataset(playlistUrl);
    const playlist = new MusicPlaylist(`${playlistUrl}#playlist-inaccessible`, ds, DataFactory);
    expect(playlist.name).toBe("Synthetic restricted playlist");
    expect(playlist.numTracks).toBe(7);
    expect(
      ds.getQuads(
        nn(`${playlistUrl}#playlist-inaccessible`),
        nn(`${SCHEMA}itemListElement`),
        null,
        null,
      ),
    ).toHaveLength(0);
    expect(ds.getQuads(nn(`${playlistUrl}#track-partial-work`), null, null, null)).toHaveLength(0);
    expect(
      ds.getQuads(
        nn(`${playlistUrl}#playlist-available`),
        nn(`${SCHEMA}itemListElement`),
        null,
        null,
      ),
    ).toHaveLength(1);
    expect(report.skipped).toBe(1);
    expect(report.written).toHaveLength(10);
    expect(report.cursor).toBe(`after:${Date.parse("2026-10-25T12:00:00Z")}`);
    expect(report.state).toMatchObject({
      cursor: report.cursor,
      lastOutcome: "success",
      counts: { skipped: 1 },
    });
    expect(
      pod
        .dataset(`${ROOT}music/recently-played.ttl`)
        .getQuads(null, TYPE, nn(`${MEDIA}PlaybackEvent`), null),
    ).toHaveLength(1);
  });

  it.each([
    401, 429, 500, 503,
  ])("surfaces playlist item status %s and retains the checkpoint", async (status) => {
    const api = source((url) => (url.pathname.endsWith("/items") ? json({}, status) : undefined));
    const state: ConnectorState = {
      connectedAt: "2026-10-25T11:00:00Z",
      cursor: "after:1000",
      lastOutcome: "success",
      counts: { documents: 10, items: 1, skipped: 0 },
    };
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: spotifyAdapter,
        mode: "live",
        podWriter: writer(),
        sourceAuth: { fetch: api },
        state,
        onState,
      }),
    ).rejects.toMatchObject({ status });
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor, lastOutcome: "error" }),
    );
    expect(
      api.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith("recently-played")),
    ).toBe(false);
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
