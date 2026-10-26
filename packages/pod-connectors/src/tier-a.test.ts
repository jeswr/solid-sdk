// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { IntegrationSyncError, RateLimitedError } from "./core/errors.js";
import { fixtureFetch } from "./core/fixture-fetch.js";
import { runImport } from "./core/import-runner.js";
import { createFetchPodWriter } from "./core/pod-writer.js";
import { PROV, Provenance } from "./core/provenance.js";
import {
  createMemoryPod,
  demoImport,
  type MemoryPod,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./core/testing.js";
import type { ConnectorState, FixtureRoute, IntegrationAdapter } from "./core/types.js";
import {
  DigitalDocument,
  ExerciseAction,
  SocialMediaPosting,
  SoftwareSourceCode,
} from "./core/vocab.js";
import { discordAdapter } from "./discord/adapter.js";
import { GUILDS } from "./discord/fixtures.js";
import { dropboxAdapter } from "./dropbox/adapter.js";
import { LIST_FOLDER } from "./dropbox/fixtures.js";
import { githubAdapter } from "./github/adapter.js";
import { REPOS } from "./github/fixtures.js";
import { notionAdapter } from "./notion/adapter.js";
import { SEARCH } from "./notion/fixtures.js";
import { redditAdapter } from "./reddit/adapter.js";
import { SAVED, SUBSCRIBED } from "./reddit/fixtures.js";
import { stravaAdapter } from "./strava/adapter.js";
import { ACTIVITIES } from "./strava/fixtures.js";
import { twitchAdapter } from "./twitch/adapter.js";
import { FOLLOWS } from "./twitch/fixtures.js";

const adapters = [
  githubAdapter,
  stravaAdapter,
  redditAdapter,
  discordAdapter,
  twitchAdapter,
  notionAdapter,
  dropboxAdapter,
];
const root = (adapter: IntegrationAdapter) =>
  `${TEST_POD_ROOT}integrations/${adapter.metadata.id}/`;
const writer = (adapter: IntegrationAdapter, pod: MemoryPod) =>
  createFetchPodWriter({
    adapterId: adapter.metadata.id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });

/** Inspect only fixture traffic, including pagination request bodies; never use a global fetch. */
async function replay(
  adapter: IntegrationAdapter,
  routes: readonly FixtureRoute[],
  options?: { pod?: MemoryPod; state?: ConnectorState },
) {
  const pod = options?.pod ?? createMemoryPod();
  const fetch = fixtureFetch(adapter.metadata.id, routes);
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  const report = await runImport({
    adapter,
    mode: "live",
    podWriter: writer(adapter, pod),
    state: options?.state,
    sourceAuth: {
      fetch: async (input, init) => {
        calls.push({
          url: new URL(String(input)),
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return fetch(input, init);
      },
    },
  });
  return { pod, report, calls };
}

/** Stable Turtle: omit run-specific activity links, retain source provenance and all mapped data. */
async function stableTurtle(dataset: Store): Promise<string> {
  const quads = [...dataset].filter((q) => q.predicate.value !== `${PROV}wasGeneratedBy`);
  quads.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  const output = new Writer();
  output.addQuads(quads as Quad[]);
  return new Promise((resolve, reject) =>
    output.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

for (const adapter of adapters) {
  describe(`${adapter.metadata.id} framework conventions`, () => {
    it("matches recorded mapping Turtle and re-imports without duplicating items or registrations", async () => {
      const first = await demoImport(adapter);
      const before = new Store();
      for (const doc of first.report.written) {
        for (const quad of first.pod.dataset(doc.url)) before.add(quad);
        const subjects = new Set([...first.pod.dataset(doc.url)].map((q) => q.subject.value));
        for (const subject of subjects) {
          const item = new Provenance(subject, first.pod.dataset(doc.url), DataFactory);
          expect(item.derivedFrom.size).toBeGreaterThan(0);
          expect(item.generatedBy.size).toBe(1);
          const source = item.sourceUrl;
          if (source) expect(item.derivedFrom.has(source)).toBe(true);
        }
      }
      const expected = await stableTurtle(before);
      await expect(`# AUTHORED-BY Codex GPT-6.1-Sol\n${expected}`).toMatchFileSnapshot(
        `./__snapshots__/tier-a-${adapter.metadata.id}.ttl`,
      );
      const urls = first.pod.urls();
      const index = first.pod.get(first.report.indexUrl);
      const second = await replay(adapter, adapter.fixtures(), {
        pod: first.pod,
        state: first.report.state,
      });
      const after = new Store();
      for (const doc of second.report.written)
        for (const quad of second.pod.dataset(doc.url)) after.add(quad);
      expect(await stableTurtle(after)).toBe(expected);
      expect(second.pod.urls()).toEqual(urls);
      expect(second.pod.get(second.report.indexUrl)).toBe(index);
      expect(second.report.state.cursor).toBe(first.report.state.cursor);
      const activities = [...second.pod.dataset(`${root(adapter)}_provenance.ttl`)].filter(
        (q) => q.object.value === `${PROV}Activity`,
      );
      expect(activities).toHaveLength(2);
      for (const quad of activities) {
        const activity = new Provenance(
          quad.subject.value,
          second.pod.dataset(`${root(adapter)}_provenance.ttl`),
          DataFactory,
        );
        expect(activity.associatedWith).toBe(`urn:solid:connector:${adapter.metadata.id}`);
        expect(activity.used.size).toBeGreaterThan(0);
        expect(activity.endedAt?.getTime()).toBeGreaterThanOrEqual(
          activity.startedAt?.getTime() ?? Number.NaN,
        );
      }
    });

    it.each([
      401, 403, 429, 503,
    ])("retains the host checkpoint on a %i source failure", async (status) => {
      const initial = await demoImport(adapter);
      let state: ConnectorState | undefined;
      await expect(
        runImport({
          adapter,
          mode: "live",
          podWriter: writer(adapter, initial.pod),
          state: initial.report.state,
          onState: (value) => {
            state = value;
          },
          sourceAuth: {
            fetch: fixtureFetch(
              adapter.metadata.id,
              adapter.fixtures().map((route) => ({ ...route, status })),
            ),
          },
        }),
      ).rejects.toBeInstanceOf(status === 429 ? RateLimitedError : IntegrationSyncError);
      expect(state).toEqual({ ...initial.report.state, lastOutcome: "error" });
    });
  });
}

describe("Tier A pagination and checkpoints", () => {
  it("pages GitHub repositories and replaces snapshots so removed repositories disappear", async () => {
    const url = "https://api.github.com/user/repos";
    const initial = await replay(githubAdapter, [
      ...githubAdapter.fixtures().filter((r) => r.url !== url),
      { url, json: Array.from({ length: 100 }, (_, i) => ({ ...REPOS[0], id: i })) },
      { url, json: [REPOS[1]] },
    ]);
    expect(
      initial.calls
        .filter((c) => c.url.pathname === "/user/repos")
        .map((c) => c.url.searchParams.get("page")),
    ).toEqual(["1", "2"]);
    expect(initial.report.state.counts.items).toBe(102); // profile plus 101 repos
    const second = await replay(
      githubAdapter,
      [
        ...githubAdapter.fixtures().filter((r) => r.url !== url),
        { url, json: [] },
        { url: "https://api.github.com/repositories", status: 404, json: null },
      ],
      { pod: initial.pod },
    );
    expect(second.pod.get(`${root(githubAdapter)}work/repositories.ttl`)).not.toContain(
      "SoftwareSourceCode",
    );
  });

  it("retains an unseen GitHub repository pushed between page requests", async () => {
    const url = "https://api.github.com/user/repos";
    const repos = Array.from({ length: 101 }, (_, i) => ({
      ...REPOS[0],
      id: i + 1,
      full_name: `synthetic/repository-${i + 1}`,
      created_at: new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString(),
      pushed_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 101 - i)).toISOString(),
    }));
    const initial = await replay(githubAdapter, [
      ...githubAdapter.fixtures().filter((r) => r.url !== url),
      { url, json: repos.slice(0, 100) },
      { url, json: repos.slice(100) },
    ]);
    const profileFetch = fixtureFetch("github", githubAdapter.fixtures());
    const pages: URL[] = [];
    const report = await runImport({
      adapter: githubAdapter,
      mode: "live",
      podWriter: writer(githubAdapter, initial.pod),
      state: initial.report.state,
      sourceAuth: {
        fetch: async (input, init) => {
          const request = new URL(String(input));
          if (request.pathname !== "/user/repos") return profileFetch(input, init);
          pages.push(request);
          const page = Number(request.searchParams.get("page"));
          if (page === 2) repos[100].pushed_at = "2026-10-26T12:00:00.000Z";
          const field = request.searchParams.get("sort") === "created" ? "created_at" : "pushed_at";
          const direction = request.searchParams.get("direction") === "asc" ? 1 : -1;
          const ordered = [...repos].sort((a, b) => direction * a[field].localeCompare(b[field]));
          return new Response(JSON.stringify(ordered.slice((page - 1) * 100, page * 100)), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    });
    const doc = `${root(githubAdapter)}work/repositories.ttl`;
    const pushed = new SoftwareSourceCode(`${doc}#repo-101`, initial.pod.dataset(doc), DataFactory);
    expect(pushed.name).toBe("synthetic/repository-101");
    expect(pushed.description).toBe(REPOS[0].description);
    expect(pushed.dateModified?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(report.state.counts.items).toBe(102);
    expect(pages.map((page) => Object.fromEntries(page.searchParams))).toEqual([
      { sort: "created", direction: "asc", per_page: "100", page: "1" },
      { sort: "created", direction: "asc", per_page: "100", page: "2" },
    ]);
  });

  it("drains short Strava windows before advancing the cursor and replaces incoming descriptions", async () => {
    const url = "https://www.strava.com/api/v3/athlete/activities";
    const initial = await replay(stravaAdapter, [
      {
        url,
        json: Array.from({ length: 2 }, (_, i) => ({
          ...ACTIVITIES[0],
          id: i,
          start_date: "2026-06-06T00:00:00Z",
        })),
      },
      { url, json: [{ id: 101, name: "Last page", start_date: "2026-06-04T00:00:00Z" }] },
      { url, json: [] },
    ]);
    expect(initial.report.cursor).toBe(String(Date.parse("2026-06-06T00:00:00Z") / 1000));
    expect(initial.calls.map((c) => c.url.searchParams.get("before"))).toEqual([
      null,
      String(Date.parse("2026-06-06T00:00:00Z") / 1000 + 1),
      String(Date.parse("2026-06-04T00:00:00Z") / 1000 + 1),
    ]);
    expect(initial.calls.every((c) => !c.url.searchParams.has("page"))).toBe(true);
    const second = await replay(
      stravaAdapter,
      [
        {
          url,
          json: [
            { id: 0, name: "Updated" },
            { name: "Missing id", start_date: "2099-01-01" },
          ],
        },
        { url, json: [] },
      ],
      { pod: initial.pod, state: initial.report.state },
    );
    expect(second.calls[0].url.searchParams.get("after")).toBe(initial.report.cursor);
    expect(second.report.cursor).toBe(initial.report.cursor);
    const doc = `${root(stravaAdapter)}fitness/activities.ttl`;
    const updated = new ExerciseAction(`${doc}#activity-0`, second.pod.dataset(doc), DataFactory);
    expect(updated.name).toBe("Updated");
    expect(updated.distance).toBeUndefined();
    expect(updated.startTime).toBeUndefined();
    expect(second.pod.get(doc)).toContain("Last page");
    expect(second.report.skipped).toBe(1);
  });

  it("pages Reddit saves to the checkpoint and snapshots all subscribed communities", async () => {
    const initial = await demoImport(redditAdapter);
    const url = "https://oauth.reddit.com/user/alice_on_reddit/saved";
    const subsUrl = "https://oauth.reddit.com/subreddits/mine/subscriber";
    const post = (id: string) => ({
      ...SAVED.data.children[0],
      data: { ...SAVED.data.children[0].data, id, name: `t3_${id}` },
    });
    const result = await replay(
      redditAdapter,
      [
        ...redditAdapter.fixtures().filter((r) => r.url !== url && r.url !== subsUrl),
        { url, json: { data: { children: [post("newest")], after: "next" } } },
        {
          url,
          json: {
            data: { children: [post("newer"), SAVED.data.children[0]], after: "must-not-fetch" },
          },
        },
        {
          url: subsUrl,
          json: { data: { children: [SUBSCRIBED.data.children[0]], after: "sub-next" } },
        },
        { url: subsUrl, json: { data: { children: [SUBSCRIBED.data.children[1]], after: null } } },
      ],
      { pod: initial.pod, state: initial.report.state },
    );
    expect(result.report.cursor).toBe("t3_newest");
    expect(
      result.calls
        .filter((c) => c.url.pathname.endsWith("/saved"))
        .map((c) => c.url.searchParams.get("after")),
    ).toEqual([null, "next"]);
    expect(
      result.calls
        .filter((c) => c.url.pathname.endsWith("/subscriber"))
        .map((c) => c.url.searchParams.get("after")),
    ).toEqual([null, "sub-next"]);
    const doc = `${root(redditAdapter)}social/saved-posts.ttl`;
    expect(
      new SocialMediaPosting(`${doc}#post-1koa3f`, result.pod.dataset(doc), DataFactory).headline,
    ).toBeDefined();
    expect(result.report.state.counts.items).toBe(4);
  });

  it("pages Discord guilds by the last snowflake and starts each snapshot at the beginning", async () => {
    const url = "https://discord.com/api/v10/users/@me/guilds";
    const initial = await replay(discordAdapter, [
      ...discordAdapter.fixtures().filter((r) => r.url !== url),
      { url, json: Array.from({ length: 200 }, (_, i) => ({ ...GUILDS[0], id: String(i + 1) })) },
      { url, json: [{ ...GUILDS[1], id: "201" }] },
    ]);
    expect(
      initial.calls
        .filter((c) => c.url.pathname.endsWith("/guilds"))
        .map((c) => c.url.searchParams.get("after")),
    ).toEqual([null, "200"]);
    expect(initial.report.state.counts.items).toBe(202);
    expect(initial.report.cursor).toBeUndefined();
  });

  it("consumes Twitch page cursors without persisting them as change cursors", async () => {
    const url = "https://api.twitch.tv/helix/channels/followed";
    const result = await replay(twitchAdapter, [
      ...twitchAdapter.fixtures().filter((r) => r.url !== url),
      { url, json: { data: [FOLLOWS.data?.[0]], pagination: { cursor: "page2" } } },
      { url, json: { data: [FOLLOWS.data?.[1]], pagination: {} } },
    ]);
    expect(
      result.calls
        .filter((c) => c.url.pathname.endsWith("/followed"))
        .map((c) => c.url.searchParams.get("after")),
    ).toEqual([null, "page2"]);
    expect(result.report.state.counts.items).toBe(2);
    expect(result.report.cursor).toBeUndefined();
  });

  it("posts Notion start_cursor until every page/database is imported", async () => {
    const url = "https://api.notion.com/v1/search";
    const result = await replay(notionAdapter, [
      {
        method: "POST",
        url,
        json: { results: SEARCH.results?.slice(0, 1), has_more: true, next_cursor: "page2" },
      },
      { method: "POST", url, json: { results: SEARCH.results?.slice(1), has_more: false } },
    ]);
    expect(result.calls.map((c) => c.body)).toEqual([
      { page_size: 100 },
      { page_size: 100, start_cursor: "page2" },
    ]);
    expect(result.report.state.counts.items).toBe(3);
    expect(result.report.cursor).toBeUndefined();
  });

  it("drains Dropbox deltas, replaces metadata and applies file/folder deletion tombstones", async () => {
    const initial = await demoImport(dropboxAdapter);
    const url = "https://api.dropboxapi.com/2/files/list_folder/continue";
    const result = await replay(
      dropboxAdapter,
      [
        {
          method: "POST",
          url,
          json: {
            entries: [
              { ".tag": "deleted", path_lower: "/tax" },
              { ".tag": "file", id: "id:new", name: "New", path_display: "/New.txt", size: 12 },
            ],
            cursor: "page2",
            has_more: true,
          },
        },
        {
          method: "POST",
          url,
          json: {
            entries: [
              {
                ...LIST_FOLDER.entries[2],
                name: "Renamed",
                path_display: "/Renamed.xlsx",
                size: undefined,
                server_modified: undefined,
              },
              { ".tag": "deleted", path_lower: "/new.txt" },
            ],
            cursor: "done",
            has_more: false,
          },
        },
      ],
      { pod: initial.pod, state: initial.report.state },
    );
    expect(result.calls.map((c) => c.body)).toEqual([
      { cursor: initial.report.cursor },
      { cursor: "page2" },
    ]);
    expect(result.report.cursor).toBe("done");
    const doc = `${root(dropboxAdapter)}documents/files.ttl`;
    const file = new DigitalDocument(
      `${doc}#file-ida4ayc_80_OEAAAAAAAAAYb`,
      result.pod.dataset(doc),
      DataFactory,
    );
    expect(file.name).toBe("Renamed");
    expect(file.contentSize).toBeUndefined();
    expect(file.dateModified).toBeUndefined();
    expect(result.pod.get(doc)).not.toContain("Tax return");
    expect(result.pod.get(doc)).not.toContain("#file-idnew");
    expect(file.description).toBe("/Renamed.xlsx");
  });

  it.each([
    notionAdapter,
    twitchAdapter,
    redditAdapter,
    dropboxAdapter,
  ])("rejects repeated cursors for $metadata.id", async (adapter) => {
    const routes = adapter.fixtures().map((route) => {
      if (adapter === notionAdapter)
        return { ...route, json: { results: [], has_more: true, next_cursor: "loop" } };
      if (adapter === twitchAdapter && route.url.endsWith("/followed"))
        return { ...route, json: { data: [], pagination: { cursor: "loop" } } };
      if (adapter === redditAdapter && route.url.endsWith("/saved"))
        return { ...route, json: { data: { children: [], after: "loop" } } };
      if (adapter === dropboxAdapter)
        return { ...route, json: { entries: [], cursor: "loop", has_more: true } };
      return route;
    });
    await expect(replay(adapter, routes)).rejects.toThrow("missing or repeated page cursor");
  });

  it("rejects a missing Notion next cursor rather than accepting a truncated snapshot", async () => {
    await expect(
      replay(notionAdapter, [
        {
          method: "POST",
          url: "https://api.notion.com/v1/search",
          json: { results: [], has_more: true },
        },
      ]),
    ).rejects.toThrow("missing or repeated page cursor");
  });
});
