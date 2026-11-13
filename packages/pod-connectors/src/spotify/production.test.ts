// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunBudget } from "../core/budget.js";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import { runImport } from "../core/import-runner.js";
import { buildAuthorizationUrl } from "../core/oauth.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { PROV } from "../core/provenance.js";
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
    budget: new RunBudget("spotify"),
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

  it.each(
    [
      null,
      [],
      "invalid",
      {},
      { items: null },
      { items: {} },
      { items: "invalid" },
      { items: [], next: 1 },
      { items: [], next: {} },
    ].map((body) => ({ body })),
  )("keeps saved tracks and the checkpoint when a page is malformed: $body", async ({ body }) => {
    const { pod, report } = await imported(
      source((url) =>
        url.pathname === "/v1/me/tracks"
          ? json({ items: [{ track: { id: "existing-saved" } }] })
          : undefined,
      ),
    );
    const savedUrl = `${ROOT}music/saved-tracks.ttl`;
    const saved = pod.get(savedUrl);
    expect(saved).toContain("existing-saved");
    const onState = vi.fn();
    for (const laterPage of [false, true]) {
      const api = source((url) => {
        if (url.pathname !== "/v1/me/tracks") return undefined;
        if (laterPage && !url.searchParams.has("offset"))
          return json({
            items: [{ track: { id: "replacement" } }],
            next: `${API}/me/tracks?limit=50&offset=1`,
          });
        return json(body);
      });
      await expect(
        runImport({
          adapter: spotifyAdapter,
          mode: "live",
          podWriter: writer(pod),
          sourceAuth: { fetch: api },
          state: report.state,
          onState,
        }),
      ).rejects.toBeInstanceOf(IntegrationSyncError);
      expect(api).toHaveBeenCalledTimes(laterPage ? 2 : 1);
      expect(pod.get(savedUrl)).toBe(saved);
      expect(onState).toHaveBeenLastCalledWith({ ...report.state, lastOutcome: "error" });
    }
  });

  it.each([
    null,
    {},
    { artists: null },
    { artists: { next: null } },
  ])("rejects malformed followed-artist envelopes: %j", async (body) => {
    await expect(
      imported(source((url) => (url.pathname === "/v1/me/following" ? json(body) : undefined))),
    ).rejects.toBeInstanceOf(IntegrationSyncError);
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

describe("Spotify playlist permissions", () => {
  const All = spotifyAdapter.metadata.scopes;
  const withoutPrivate = All.filter((scope) => scope !== "playlist-read-private");
  const withoutCollaborative = All.filter((scope) => scope !== "playlist-read-collaborative");
  const withoutBoth = withoutPrivate.filter((scope) => scope !== "playlist-read-collaborative");
  const Playlists = `${ROOT}music/playlists.ttl`;
  const Name = nn(`${SCHEMA}name`);
  const track = (id: string, name: string) => ({ item: { id, name, type: "track" } });
  function playlists(listed: readonly string[], sharedItems: unknown[]) {
    return source((url) => {
      if (url.pathname === "/v1/me/playlists")
        return json({
          items: [
            { id: "mine", name: "Mine", owner: { id: "fixture-user" }, collaborative: false },
            { id: "shared", name: "Shared", owner: { id: "fixture-other" }, collaborative: true },
          ].filter(({ id }) => listed.includes(id)),
        });
      if (url.pathname === "/v1/playlists/mine/items")
        return json({ items: [track("a", "A"), track("a", "A"), track("s", "S")] });
      if (url.pathname === "/v1/playlists/shared/items") return json({ items: sharedItems });
      return undefined;
    });
  }
  const run = (api: typeof fetch, pod: ReturnType<typeof createMemoryPod>, scopes?: string[]) =>
    runImport({
      adapter: spotifyAdapter,
      mode: "live",
      podWriter: writer(pod),
      sourceAuth: { fetch: api },
      ...(scopes ? { scopes } : {}),
    });
  const names = (ds: DatasetCore, subject: string) =>
    [...ds.match(nn(subject), Name, null, null)].map((quad) => quad.object.value).sort();

  it("keeps previously imported playlists of a withheld kind on a partial re-sync", async () => {
    const pod = createMemoryPod();
    await run(playlists(["mine", "shared"], [track("s", "S")]), pod);
    const full = pod.dataset(Playlists);
    const mine = [...full].filter(({ subject }) =>
      [`${Playlists}#playlist-mine`, `${Playlists}#track-a`].includes(subject.value),
    );
    const partial = playlists(["mine", "shared"], [track("s", "S renamed"), track("b", "B")]);
    await run(partial, pod, withoutPrivate);
    const ds = pod.dataset(Playlists);
    expect(partial.mock.calls.some(([input]) => String(input).includes("/playlists/mine/"))).toBe(
      false,
    );
    expect(new MusicPlaylist(`${Playlists}#playlist-mine`, ds, DataFactory).name).toBe("Mine");
    for (const quad of mine.filter(({ predicate }) => !predicate.value.startsWith(PROV)))
      expect(ds.has(quad)).toBe(true);
    for (const position of [1, 2, 3])
      expect(ds.match(nn(`${Playlists}#playlist-mine-item-${position}`)).size).toBeGreaterThan(0);
    // The shared track takes this run's description; the collaborative playlist is updated.
    expect(names(ds, `${Playlists}#track-s`)).toEqual(["S renamed"]);
    expect(names(ds, `${Playlists}#track-b`)).toEqual(["B"]);
    expect(ds.match(nn(`${Playlists}#playlist-shared-item-2`)).size).toBeGreaterThan(0);

    // Only a full grant proves an unlisted playlist was deleted at the source.
    await run(playlists(["shared"], [track("b", "B")]), pod);
    const latest = pod.dataset(Playlists);
    expect(latest.match(nn(`${Playlists}#playlist-mine`)).size).toBe(0);
    expect(latest.match(nn(`${Playlists}#track-a`)).size).toBe(0);
  });

  // Spotify leaves playlists of a withheld kind out of /me/playlists entirely.
  it.each([
    ["private ones", withoutPrivate, ["shared"], "mine", "shared"],
    ["private ones, with no public playlists listed", withoutPrivate, [], "mine", "shared"],
    ["collaborative ones", withoutCollaborative, ["mine"], "shared", "mine"],
    ["collaborative ones, with nothing listed", withoutCollaborative, [], "shared", "mine"],
    ["both kinds", withoutBoth, [], "mine", "shared"],
  ] as const)("keeps playlists the source omits while withholding %s", async (_kind, scopes, listed, kept, other) => {
    const pod = createMemoryPod();
    await run(playlists(["mine", "shared"], [track("s", "S")]), pod);
    const before = pod.dataset(Playlists);
    const stored = (subject: string) =>
      [...before].filter(
        (quad) => quad.subject.value === subject && !quad.predicate.value.startsWith(PROV),
      );
    const keptQuads = [
      `${Playlists}#playlist-${kept}`,
      ...[1, 2, 3].map((n) => `${Playlists}#playlist-${kept}-item-${n}`),
    ].flatMap(stored);
    expect(keptQuads.length).toBeGreaterThan(0);
    const api = playlists(listed, [track("s", "S")]);
    const report = await run(api, pod, [...scopes]);
    const ds = pod.dataset(Playlists);
    for (const quad of keptQuads) expect(ds.has(quad)).toBe(true);
    expect(ds.match(nn(`${Playlists}#playlist-${kept}`), TYPE).size).toBeGreaterThan(0);
    // A listed playlist of a granted kind is re-described; an unlisted one is kept too while
    // any playlist scope is withheld, because the listing cannot prove it was deleted.
    expect(ds.match(nn(`${Playlists}#playlist-${other}`), TYPE).size).toBeGreaterThan(0);
    expect(api.mock.calls.some(([input]) => String(input).includes(`/playlists/${kept}/`))).toBe(
      false,
    );
    expect(report.skipped).toBeUndefined();
  });

  it("does not carry forward the item or track nodes of a playlist this run re-describes", async () => {
    const pod = createMemoryPod();
    await run(playlists(["mine", "shared"], [track("s", "S"), track("old", "Old")]), pod);
    await run(playlists(["shared"], [track("b", "B")]), pod, withoutPrivate);
    const ds = pod.dataset(Playlists);
    expect(ds.match(nn(`${Playlists}#playlist-shared-item-2`)).size).toBe(0);
    expect(ds.match(nn(`${Playlists}#track-old`)).size).toBe(0);
    expect(names(ds, `${Playlists}#track-b`)).toEqual(["B"]);
    expect(new MusicPlaylist(`${Playlists}#playlist-mine`, ds, DataFactory).name).toBe("Mine");
  });

  // AUTHORED-BY Claude Opus 5.5
  it("does not count playlists it only keeps from the stored snapshot as added items", async () => {
    const synced = createMemoryPod();
    await run(playlists(["mine", "shared"], [track("s", "S")]), synced);
    const kept = await run(playlists([], []), synced, withoutPrivate);
    expect(
      synced.dataset(Playlists).match(nn(`${Playlists}#playlist-mine`), TYPE).size,
    ).toBeGreaterThan(0);
    // The same partial run against an empty pod imports exactly what this one imported.
    const fresh = await run(playlists([], []), createMemoryPod(), withoutPrivate);
    expect(kept.state?.counts.items).toBe(fresh.state?.counts.items);
    expect(kept.state?.counts.documents).toBe(fresh.state?.counts.documents);
  });

  it("keeps no earlier playlists when a partial grant re-syncs an empty pod", async () => {
    const pod = createMemoryPod();
    const report = await run(playlists([], []), pod, withoutPrivate);
    expect(report.written.some(({ url }) => url === Playlists)).toBe(true);
    expect(pod.dataset(Playlists).match(null, TYPE, nn(`${SCHEMA}MusicPlaylist`)).size).toBe(0);
  });

  it("omits a withheld kind without requesting its contents when nothing was imported before", async () => {
    const pod = createMemoryPod();
    const api = playlists(["mine", "shared"], [track("s", "S")]);
    const report = await run(api, pod, withoutPrivate);
    const ds = pod.dataset(Playlists);
    expect(ds.match(nn(`${Playlists}#playlist-mine`)).size).toBe(0);
    expect(new MusicPlaylist(`${Playlists}#playlist-shared`, ds, DataFactory).name).toBe("Shared");
    expect(api.mock.calls.some(([input]) => String(input).includes("/playlists/mine/"))).toBe(
      false,
    );
    expect(report.skipped).toBeUndefined();
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
    const promise = spotifyJson(api, `${API}/me/tracks`, new RunBudget("spotify"));
    await vi.advanceTimersByTimeAsync(1999);
    expect(api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toEqual({ items: [] });
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("bounds retries and surfaces malformed Retry-After", async () => {
    vi.useFakeTimers();
    const api = vi.fn<typeof fetch>(async () => json({}, 429, { "retry-after": "0" }));
    const outcome = expect(
      spotifyJson(api, `${API}/me/tracks`, new RunBudget("spotify")),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await vi.runAllTimersAsync();
    await outcome;
    expect(api).toHaveBeenCalledTimes(4);
    for (const header of [undefined, "garbage", "-1", "0.5", "999999999999"])
      await expect(
        spotifyJson(
          async () => json({}, 429, header ? { "retry-after": header } : {}),
          `${API}/me/tracks`,
          new RunBudget("spotify"),
        ),
      ).rejects.toBeInstanceOf(RateLimitedError);
  });
  it("ends a Retry-After wait as soon as the run is cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = vi.fn<typeof fetch>(async () => json({}, 429, { "retry-after": "3600" }));
    const pending = spotifyJson(
      api,
      `${API}/me/tracks`,
      new RunBudget("spotify"),
      controller.signal,
    );
    pending.catch(() => {});
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("does not start a Retry-After wait for a cancelled run", async () => {
    const controller = new AbortController();
    const api = vi.fn<typeof fetch>(async () => {
      controller.abort(new Error("cancelled"));
      return json({}, 429, { "retry-after": "3600" });
    });
    await expect(
      spotifyJson(api, `${API}/me/tracks`, new RunBudget("spotify"), controller.signal),
    ).rejects.toThrow("cancelled");
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("retries after the delay while the run's signal stays live", async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, "removeEventListener");
    const api = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "1" }))
      .mockResolvedValueOnce(json({ items: [] }));
    const promise = spotifyJson(api, `${API}/me/tracks`, new RunBudget("spotify"), signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toEqual({ items: [] });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("cancels an import waiting on a rate limit through runImport's signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = source((url) =>
      url.pathname === "/v1/me/tracks" ? json({}, 429, { "retry-after": "3600" }) : undefined,
    );
    const pending = runImport({
      adapter: spotifyAdapter,
      mode: "live",
      podWriter: writer(),
      sourceAuth: { fetch: api },
      signal: controller.signal,
    });
    pending.catch(() => {});
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 500, 503])("surfaces %s without unbounded retries", async (status) => {
    const api = vi.fn<typeof fetch>(async () => json({}, status));
    await expect(
      spotifyJson(api, `${API}/me/tracks`, new RunBudget("spotify")),
    ).rejects.toMatchObject({ status });
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

it("caps a hostile Retry-After at the remaining wall-clock budget", async () => {
  vi.useFakeTimers();
  const budget = new RunBudget("spotify", { maxDurationMs: 10 });
  const api = vi.fn<typeof fetch>(async () => json({}, 429, { "retry-after": "2147483" }));
  const pending = spotifyJson(api, `${API}/me/tracks`, budget);
  const failure = expect(pending).rejects.toMatchObject({
    name: "RunBudgetExceededError",
    resource: "duration",
  });
  await vi.advanceTimersByTimeAsync(10);
  await failure;
  expect(api).toHaveBeenCalledOnce();
});
