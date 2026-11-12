// AUTHORED-BY Codex GPT-6
import {
  createRegistry,
  fileAdapterById,
  type ImportReport,
  runFileImport,
  runImport,
} from "@jeswr/pod-connectors";
import { createSpotifyAdapter } from "@jeswr/pod-connectors/adapters/spotify";
import { fixtureFetch } from "@jeswr/pod-connectors/core/fixture-fetch";
import { memoryFile } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  createImportWriter,
  fetchWithSignal,
  fileWithSignal,
  runSavedImport,
  SignInExpiredError,
  tokenStillUsable,
} from "../src/apps/home/components/connect/import-service";
import { withRequiredScopes, withSelectedScopes } from "../src/apps/home/components/connect/scopes";
import { isDemoImport } from "../src/apps/home/lib/connect";
import {
  type ConnectionAction,
  connectionReducer,
} from "../src/apps/home/lib/connect/connection-state";
import { provenanceOf } from "../src/apps/home/lib/model/provenance";
import { createConnectorPreferences } from "../src/apps/home/state/connectors";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

async function setup() {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
  });
  const session = { webId: DEMO_WEBID, storageUrl: DEMO_ROOT, fetch: pod.fetch };
  return { pod, session };
}
describe("Connect uses the real package writer against the suite demo pod", () => {
  it.each([
    ["playlist-read-private", "Focus Flow", "Sunday Morning", "5ABHKGoOzxkaa28ttQV9sE"],
    ["playlist-read-collaborative", "Sunday Morning", "Focus Flow", "37i9dQZF1DXcBWIGoYBM5M"],
  ])("filters Spotify playlists independently for %s", async (scope, included, excluded, excludedId) => {
    const { session } = await setup();
    const source = fixtureTransport("spotify");
    const report = await runImport({
      adapter: withSelectedScopes(source.adapter, [scope]),
      mode: "live",
      sourceAuth: { fetch: source.fetch },
      podWriter: createImportWriter(session, "spotify", new AbortController().signal),
    });
    expect(report.written).toHaveLength(1);
    const written = report.written[0];
    if (!written) throw new Error("Missing playlist document");
    const body = await (await session.fetch(written.url)).text();
    expect(body).toContain(included);
    expect(body).not.toContain(excluded);
    expect(source.fetch.mock.calls.some(([input]) => String(input).includes(excludedId))).toBe(
      false,
    );
  });
  it("keeps previously imported private playlists when a re-sync selects shared playlists only", async () => {
    const { session } = await setup();
    const source = fixtureTransport("spotify");
    const sync = (scopes: readonly string[]) =>
      runImport({
        adapter: withSelectedScopes(source.adapter, scopes),
        mode: "live",
        sourceAuth: { fetch: source.fetch },
        podWriter: createImportWriter(session, "spotify", new AbortController().signal),
      });
    await sync(source.adapter.metadata.scopes);
    source.fetch.mockClear();
    const report = await sync(["playlist-read-collaborative"]);
    const playlists = report.written.find(({ url }) => url.endsWith("playlists.ttl"));
    if (!playlists) throw new Error("Missing playlist document");
    const body = await (await session.fetch(playlists.url)).text();
    expect(body).toContain("Sunday Morning");
    expect(body).toContain("Focus Flow");
    // The withheld private playlist's contents are carried forward, never re-requested.
    expect(
      source.fetch.mock.calls.some(([input]) => String(input).includes("37i9dQZF1DXcBWIGoYBM5M")),
    ).toBe(false);
  });
  // Spotify leaves playlists of a withheld kind out of /me/playlists altogether.
  it.each([
    ["private playlists", ["playlist-read-collaborative"], "keep-listed", "Focus Flow"],
    [
      "private playlists, with nothing listed",
      ["playlist-read-collaborative"],
      "none",
      "Focus Flow",
    ],
    ["shared playlists", ["playlist-read-private"], "keep-listed", "Sunday Morning"],
    ["shared playlists, with nothing listed", ["playlist-read-private"], "none", "Sunday Morning"],
  ] as const)("keeps earlier %s when a partial grant omits them from the source listing", async (_kind, scopes, listing, kept) => {
    const { session } = await setup();
    const source = fixtureTransport("spotify");
    const sync = (selected: readonly string[], transport: typeof fetch) =>
      runImport({
        adapter: withSelectedScopes(source.adapter, selected),
        mode: "live",
        sourceAuth: { fetch: transport },
        podWriter: createImportWriter(session, "spotify", new AbortController().signal),
      });
    await sync(source.adapter.metadata.scopes, source.fetch);
    const like = vi.fn<typeof fetch>(async (input, init) => {
      const response = await source.fetch(input, init);
      if (new URL(String(input)).pathname !== "/v1/me/playlists") return response;
      const page = (await response.json()) as { items: { collaborative?: boolean }[] };
      const visible = page.items.filter(
        (item) =>
          listing === "keep-listed" &&
          (scopes as readonly string[]).includes(
            item.collaborative === true ? "playlist-read-collaborative" : "playlist-read-private",
          ),
      );
      return Response.json({ ...page, items: visible });
    });
    const report = await sync(scopes, like);
    const playlists = report.written.find(({ url }) => url.endsWith("playlists.ttl"));
    if (!playlists) throw new Error("Missing playlist document");
    const body = await (await session.fetch(playlists.url)).text();
    expect(body).toContain(kept);
    // Nothing of the omitted kind is requested again.
    expect(
      like.mock.calls.some(([input]) =>
        String(input).includes(
          kept === "Focus Flow" ? "37i9dQZF1DXcBWIGoYBM5M" : "5ABHKGoOzxkaa28ttQV9sE",
        ),
      ),
    ).toBe(false);
  });
  it("charges the original Spotify playlist list to the run's data budget before omitting withheld kinds", async () => {
    const { session } = await setup();
    const adapter = createSpotifyAdapter({ maxRequests: 100, maxItems: 10_000, maxBytes: 1024 });
    const encoder = new TextEncoder();
    let index = 0;
    let cancelled = false;
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/me") return Response.json({ id: "fixture-user" });
      if (url.pathname !== "/v1/me/playlists") throw new Error(`Unexpected request ${url}`);
      // Private playlists only: filtering them out first would leave a tiny body.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"items":['));
        },
        pull(controller) {
          if (index >= 250) {
            controller.enqueue(encoder.encode('{"id":"last"}]}'));
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`{"id":"private-${index++}","collaborative":false},`));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    };
    await expect(
      runImport({
        adapter: withSelectedScopes(adapter, ["playlist-read-collaborative"]),
        mode: "live",
        sourceAuth: { fetch: transport },
        podWriter: createImportWriter(session, "spotify", new AbortController().signal),
      }),
    ).rejects.toThrow("data budget");
    // The bounded reader stops the ~10 KB body early instead of buffering it whole.
    expect(cancelled).toBe(true);
    expect(index).toBeLessThan(250);
  });
  it("imports only selected Spotify collections and does not advance an omitted history checkpoint", async () => {
    const { session } = await setup();
    const original = createRegistry().adapterById("spotify");
    if (!original) throw new Error("Spotify adapter missing");
    const report = await runImport({
      adapter: withSelectedScopes(original, ["user-top-read"]),
      mode: "demo",
      podWriter: createImportWriter(session, "spotify", new AbortController().signal),
    });
    expect(report.written).toHaveLength(6);
    expect(report.state?.counts.items).toBe(12);
    expect(report.written.every(({ url }) => url.includes("/top-"))).toBe(true);
    expect(report.cursor).toBeUndefined();
  });
  it("drops the adapter's commit step from a partial-scope run along with its cursor", async () => {
    const commit = vi.fn(async () => undefined);
    const base = createRegistry().adapterById("spotify");
    if (!base) throw new Error("Spotify adapter missing");
    const adapter = withSelectedScopes(
      { ...base, import: async () => ({ cursor: "next", commit }) },
      ["user-top-read"],
    );
    const ctx = { cursor: "previous" } as Parameters<typeof adapter.import>[0];
    const partial = await adapter.import(ctx);
    expect(partial).toEqual({ cursor: "previous" });
    expect("commit" in partial).toBe(false);
    const full = await withSelectedScopes(
      { ...base, import: async () => ({ cursor: "next", commit }) },
      base.metadata.scopes,
    ).import(ctx);
    expect(full).toEqual({ cursor: "next", commit });
  });
  it("imports the recorded Spotify fixture, with readable provenance and stable resource URLs/counts", async () => {
    const { pod, session } = await setup();
    const adapter = createRegistry().adapterById("spotify");
    if (!adapter) throw new Error("Spotify adapter missing");
    const writer = () => createImportWriter(session, "spotify", new AbortController().signal);
    const first = await runImport({ adapter, mode: "demo", podWriter: writer() });
    expect(first.state?.counts.items).toBe(25);
    expect(first.written.length).toBe(10);
    const counts = first.state?.counts;
    const urls = first.written.map(({ url }) => url).sort();
    const snapshotUrls = pod
      .snapshot()
      .resources.map(([url]) => url)
      .sort();
    for (const { url } of first.written) {
      const response = await pod.fetch(url);
      const ds = new Store(new Parser({ baseIRI: url }).parse(await response.text()));
      expect(
        ds.countQuads(null, DataFactory.namedNode(`${NS.PROV}wasDerivedFrom`), null, null),
      ).toBeGreaterThan(0);
      expect(
        provenanceOf(ds, url, url, { storage: DEMO_ROOT, userWebId: DEMO_WEBID }),
      ).toMatchObject({ kind: "source", label: "Spotify" });
    }
    const second = await runImport({ adapter, mode: "demo", podWriter: writer() });
    expect(second.written.map(({ url }) => url).sort()).toEqual(urls);
    expect(second.state?.counts).toEqual(counts);
    expect(
      pod
        .snapshot()
        .resources.map(([url]) => url)
        .sort(),
    ).toEqual(snapshotUrls);
  });
  it("imports a Netflix CSV with one malformed row, records skips and reuses the same document", async () => {
    const { session } = await setup();
    const adapter = fileAdapterById("netflix");
    if (!adapter) throw new Error("Netflix adapter missing");
    const file = memoryFile(
      "NetflixViewingHistory.csv",
      "Title,Date\nExample Movie,10/25/2026\nExample Episode,10/26/2026\nBad row,10/27/2026,extra\n",
      "text/csv",
    );
    const writer = () => createImportWriter(session, "netflix", new AbortController().signal);
    const first = await runFileImport({ adapter, file, podWriter: writer() });
    expect(first.skipped).toBe(1);
    expect(first.state?.counts.items).toBe(2);
    const second = await runFileImport({ adapter, file, podWriter: writer() });
    expect(second.written).toEqual(first.written);
    expect(second.state?.counts).toEqual(first.state?.counts);
  });
  it("cancels before a write, keeps completed writes, releases the runner and can retry", async () => {
    const { session, pod } = await setup();
    const adapter = createRegistry().adapterById("spotify");
    if (!adapter) throw new Error("Spotify adapter missing");
    const controller = new AbortController();
    let writtenUrl = "";
    const writer = createImportWriter(session, "spotify", controller.signal, (url) => {
      writtenUrl = url;
      controller.abort();
    });
    await expect(runImport({ adapter, mode: "demo", podWriter: writer })).rejects.toThrow();
    expect(pod.has(writtenUrl)).toBe(true);
    expect(
      (
        await runImport({
          adapter,
          mode: "demo",
          podWriter: createImportWriter(session, "spotify", new AbortController().signal),
        })
      ).written.length,
    ).toBe(10);
    const aborted = new AbortController();
    aborted.abort();
    await expect(async () =>
      createImportWriter(session, "spotify", aborted.signal).read("music/top-tracks.ttl"),
    ).rejects.toThrow();
  });
  it("forwards cancellation through source requests and preserves request/init signals", async () => {
    const controller = new AbortController();
    const request = new AbortController();
    const init = new AbortController();
    let received: AbortSignal | null | undefined;
    const transport: typeof fetch = async (_input, options) => {
      received = options?.signal;
      return new Response();
    };
    const fetch = fetchWithSignal(transport, controller.signal);
    await fetch(new Request("https://source.example/", { signal: request.signal }), {
      signal: init.signal,
    });
    init.abort();
    expect(received?.aborted).toBe(true);
    await fetch("https://source.example/");
    controller.abort();
    expect(() => fetch("https://source.example/")).toThrow();
  });
  it("aborts a pending file read and supports reopenable ranges", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const file = new File(["Title,Date\nExample,10/25/2026\n"], "NetflixViewingHistory.csv");
    const ranged = fileWithSignal(file, controller.signal);
    expect(await ranged.text()).toContain("Title,Date");
    expect(await new Response(ranged.slice?.(0, 5).stream()).text()).toBe("Title");
    const stalled = Object.assign(file, {
      stream: () =>
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
    });
    const reader = fileWithSignal(stalled, controller.signal).stream?.().getReader();
    const pending = reader?.read();
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toBe(true);
    await expect(fileWithSignal(file, controller.signal).text()).rejects.toThrow();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function preferencesPair(onSet: () => void = () => {}) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    setItem: (key: string, value: string) => {
      onSet();
      data.set(key, value);
    },
  };
  return [createConnectorPreferences(storage), createConnectorPreferences(storage)] as const;
}
function updater(store: ReturnType<typeof createConnectorPreferences>, id: string) {
  return (action: ConnectionAction) => {
    const connections = store.read(DEMO_WEBID);
    const next = connectionReducer(connections[id], action);
    store.write(DEMO_WEBID, id, next);
    return next;
  };
}
function fixtureTransport(id: string) {
  const adapter = createRegistry().adapterById(id);
  if (!adapter) throw new Error("Missing adapter");
  return {
    adapter,
    fetch: vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const route = [...adapter.fixtures()]
        .sort((a, b) => b.url.length - a.url.length)
        .find((route) => url.href.startsWith(route.url));
      if (!route) throw new Error(`No route for ${url}`);
      return Response.json(route.json);
    }),
  };
}

describe("saved import transactions", () => {
  it("keeps active records and checkpoints when different connectors persist concurrently in two tabs", async () => {
    let interleave: (() => void) | undefined;
    const [tab1, tab2] = preferencesPair(() => {
      const callback = interleave;
      interleave = undefined;
      callback?.();
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const update1 = updater(tab1, "spotify");
    const update2 = updater(tab2, "dropbox");
    const url = `${DEMO_ROOT}integrations/dropbox/files.ttl`;
    const report = (id: string): ImportReport => ({
      adapterId: id,
      mode: "live",
      written: [],
      categories: [],
      indexUrl: `${DEMO_ROOT}index`,
      cursor: `${id}-checkpoint`,
    });
    const dropbox = runSavedImport(
      DEMO_ROOT,
      "dropbox",
      "live",
      new AbortController().signal,
      update2,
      async () => {
        entered.resolve();
        await release.promise;
        return report("dropbox");
      },
    );
    await entered.promise;
    await runSavedImport(
      DEMO_ROOT,
      "spotify",
      "live",
      new AbortController().signal,
      update1,
      async () => {
        // Simulate another tab committing after this tab's read, before its setItem.
        interleave = () => {
          update2({ type: "written", url });
        };
        update1({ type: "written", url: `${DEMO_ROOT}integrations/spotify/music.ttl` });
        expect(tab1.read(DEMO_WEBID).dropbox).toMatchObject({
          lastOutcome: "incomplete",
          resourceUrls: [url],
        });
        return report("spotify");
      },
    );
    release.resolve();
    await dropbox;
    expect(tab1.read(DEMO_WEBID)).toMatchObject({
      spotify: { cursor: "spotify-checkpoint", lastOutcome: "ok" },
      dropbox: { cursor: "dropbox-checkpoint", lastOutcome: "ok", resourceUrls: [url] },
    });
  });

  it("retains untouched demos after OAuth cancellation and replaces demo history before live merging", async () => {
    const { session } = await setup();
    const [store] = preferencesPair();
    const source = fixtureTransport("spotify");
    const update = updater(store, "spotify");
    const run = (mode: "demo" | "live", transport = source.fetch as typeof fetch) =>
      runSavedImport(
        DEMO_ROOT,
        "spotify",
        mode,
        new AbortController().signal,
        update,
        (cursor, connection) =>
          runImport({
            adapter: withSelectedScopes(
              source.adapter,
              mode === "demo" ? source.adapter.metadata.scopes : ["user-read-recently-played"],
            ),
            mode,
            sourceAuth: { fetch: transport },
            ...(cursor ? { cursor } : {}),
            podWriter: createImportWriter(
              session,
              "spotify",
              new AbortController().signal,
              (url, doc) => {
                if (doc.slug !== "_provenance.ttl") update({ type: "written", url });
              },
              mode === "demo" ? [] : connection.demoResourceUrls,
            ),
          }),
      );
    const demo = await run("demo");
    const history = demo.written.find(({ url }) => url.endsWith("recently-played.ttl"))?.url;
    const top = demo.written.find(({ url }) => url.endsWith("top-tracks.ttl"))?.url;
    if (!history || !top) throw new Error("Missing demo documents");
    const controller = new AbortController();
    await expect(
      runSavedImport(DEMO_ROOT, "spotify", "live", controller.signal, update, async () => {
        controller.abort();
        controller.signal.throwIfAborted();
        throw new Error("unreachable");
      }),
    ).rejects.toThrow();
    expect(isDemoImport(history, store.read(DEMO_WEBID))).toBe(true);
    expect(isDemoImport(top, store.read(DEMO_WEBID))).toBe(true);
    let sequence = 0;
    const live: typeof fetch = async (input, init) => {
      if (String(input).includes("recently-played")) {
        sequence++;
        return Response.json({
          items: [
            {
              track: { id: `live-${sequence}`, name: `Live track ${sequence}` },
              played_at: `2026-11-0${sequence}T12:00:00Z`,
            },
          ],
        });
      }
      return source.fetch(input, init);
    };
    await run("live", live);
    expect(isDemoImport(history, store.read(DEMO_WEBID))).toBe(false);
    expect(isDemoImport(top, store.read(DEMO_WEBID))).toBe(true);
    await run("live", live);
    const body = await (await session.fetch(history)).text();
    expect(body).toContain("Live track 1");
    expect(body).toContain("Live track 2");
    expect(body).not.toContain("Never Gonna Give You Up");
    expect(body).not.toContain("2026-10-25");
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({
      resourceUrls: [history],
      lastOutcome: "ok",
    });
  });
  it("queues overlapping Discord snapshots through persistence, so the newer guild survives", async () => {
    const { session } = await setup();
    const [tab1, tab2] = preferencesPair();
    const entered = deferred<void>();
    const release = deferred<void>();
    const source1 = fixtureTransport("discord");
    const source2 = fixtureTransport("discord");
    const update1 = updater(tab1, "discord");
    const update2 = updater(tab2, "discord");
    const firstTransport: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith("/guilds")) {
        entered.resolve();
        await release.promise;
        return Response.json([{ id: "old", name: "Original guild" }]);
      }
      return source1.fetch(input, init);
    };
    const start = (source: typeof source1, update: typeof update1, transport: typeof fetch) =>
      runSavedImport(
        DEMO_ROOT,
        "discord",
        "live",
        new AbortController().signal,
        update,
        async (cursor) =>
          runImport({
            adapter: source.adapter,
            mode: "live",
            sourceAuth: { fetch: transport },
            ...(cursor ? { cursor } : {}),
            podWriter: createImportWriter(
              session,
              "discord",
              new AbortController().signal,
              (url) => {
                update({ type: "written", url });
              },
            ),
          }),
      );
    const first = start(source1, update1, firstTransport);
    await entered.promise;
    let priorOutcome: string | undefined;
    const second = start(
      source2,
      (action) => {
        if (action.type === "start") priorOutcome = tab2.read(DEMO_WEBID).discord?.lastOutcome;
        return update2(action);
      },
      source2.fetch,
    );
    // The old snapshot is deliberately stalled while a second tab requests a sync.
    await Promise.resolve();
    expect(source2.fetch).not.toHaveBeenCalled();
    release.resolve();
    const [old, latest] = await Promise.all([first, second]);
    expect(priorOutcome).toBe("ok");
    expect(old.state?.counts.items).toBe(2);
    expect(latest.state?.counts.items).toBe(3);
    const servers = latest.written.find(({ url }) => url.endsWith("servers.ttl"));
    if (!servers) throw new Error("Missing Discord guild document");
    const body = await (await session.fetch(servers.url)).text();
    expect(body).toContain("Solid Community");
    expect(body).toContain("Sourdough Bakers");
    expect(body).not.toContain("Original guild");
    expect(tab1.read(DEMO_WEBID).discord).toMatchObject({ added: 3, lastOutcome: "ok" });
  });
  it("loads the successful checkpoint after an overlapping run persists it", async () => {
    const [tab1, tab2] = preferencesPair();
    const entered = deferred<void>();
    const release = deferred<void>();
    const report: ImportReport = {
      adapterId: "dropbox",
      mode: "live",
      written: [],
      categories: [],
      indexUrl: "https://pod.example/index",
      cursor: "new-checkpoint",
    };
    const run = (store: typeof tab1, work: (cursor: string | undefined) => Promise<ImportReport>) =>
      runSavedImport(
        DEMO_ROOT,
        "dropbox",
        "live",
        new AbortController().signal,
        updater(store, "dropbox"),
        work,
      );
    const first = run(tab1, async () => {
      entered.resolve();
      await release.promise;
      return report;
    });
    await entered.promise;
    const work = vi.fn(async (cursor) => {
      expect(cursor).toBe("new-checkpoint");
      return report;
    });
    const second = run(tab2, work);
    expect(work).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([first, second]);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it.each([
    "dropbox",
    "spotify",
  ])("starts a live %s import without the previous demo checkpoint", async (id) => {
    const { session } = await setup();
    const [store] = preferencesPair();
    const source = fixtureTransport(id);
    const update = updater(store, id);
    const run = (mode: "demo" | "live") =>
      runSavedImport(DEMO_ROOT, id, mode, new AbortController().signal, update, async (cursor) => {
        if (mode === "live") expect(cursor).toBeUndefined();
        return runImport({
          adapter: source.adapter,
          mode,
          ...(cursor ? { cursor } : {}),
          sourceAuth: { fetch: source.fetch },
          podWriter: createImportWriter(session, id, new AbortController().signal),
        });
      });
    await run("demo");
    expect(store.read(DEMO_WEBID)[id]?.cursor).toBeTruthy();
    await run("live");
    const urls = source.fetch.mock.calls.map(([input]) => new URL(String(input)));
    if (id === "dropbox") expect(urls[0]?.pathname).toBe("/2/files/list_folder");
    else
      expect(
        urls.find((url) => url.pathname.endsWith("recently-played"))?.searchParams.has("after"),
      ).toBe(false);
    expect(store.read(DEMO_WEBID)[id]).toMatchObject({ mode: "live", lastOutcome: "ok" });
  });
  it("cancels during a Spotify Retry-After wait, records the run incomplete and releases the reservation", async () => {
    const { session } = await setup();
    const [store] = preferencesPair();
    const update = updater(store, "spotify");
    const source = fixtureTransport("spotify");
    const controller = new AbortController();
    const limited = deferred<void>();
    const transport: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/v1/me/tracks") {
        limited.resolve();
        return new Response(null, { status: 429, headers: { "retry-after": "3600" } });
      }
      return source.fetch(input, init);
    };
    const pending = runSavedImport(DEMO_ROOT, "spotify", "live", controller.signal, update, () =>
      runImport({
        adapter: withSelectedScopes(source.adapter, source.adapter.metadata.scopes),
        mode: "live",
        sourceAuth: { fetch: fetchWithSignal(transport, controller.signal) },
        podWriter: createImportWriter(session, "spotify", controller.signal),
        signal: controller.signal,
      }),
    );
    await limited.promise;
    controller.abort();
    // Settles now rather than after the hour-long Retry-After.
    await expect(pending).rejects.toThrow();
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({ lastOutcome: "incomplete" });
    const next = vi.fn(
      async (): Promise<ImportReport> => ({
        adapterId: "spotify",
        mode: "live",
        written: [],
        categories: [],
        indexUrl: `${DEMO_ROOT}index`,
      }),
    );
    await runSavedImport(DEMO_ROOT, "spotify", "live", new AbortController().signal, update, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({ lastOutcome: "ok" });
  }, 5_000);
  it.each([
    false,
    true,
  ])("persists a failed or cancelled run before releasing its reservation (cancelled=%s)", async (cancelled) => {
    const [store] = preferencesPair();
    const controller = new AbortController();
    const update = updater(store, "dropbox");
    update({ type: "start", at: new Date().toISOString(), mode: "live" });
    update({
      type: "success",
      at: new Date().toISOString(),
      added: 2,
      skipped: 0,
      cursor: "last-good",
    });
    await expect(
      runSavedImport(DEMO_ROOT, "dropbox", "live", controller.signal, update, async () => {
        if (cancelled) controller.abort();
        throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");
    expect(store.read(DEMO_WEBID).dropbox).toMatchObject({
      lastOutcome: cancelled ? "incomplete" : "error",
      cursor: "last-good",
    });
  });
});

describe("sign-in before recording a run", () => {
  it("signs in outside the connector reservation, so an unfinished sign-in blocks no other import", async () => {
    const [store] = preferencesPair();
    const update = updater(store, "spotify");
    const signingIn = deferred<{ fetch: typeof fetch }>();
    const entered = deferred<void>();
    const report = (cursor: string): ImportReport => ({
      adapterId: "spotify",
      mode: "live",
      written: [],
      categories: [],
      indexUrl: `${DEMO_ROOT}index`,
      cursor,
    });
    const order: string[] = [];
    const first = runSavedImport(
      DEMO_ROOT,
      "spotify",
      "live",
      new AbortController().signal,
      update,
      async (cursor) => {
        order.push(`first run from ${cursor}`);
        return report("after-first");
      },
      async () => {
        entered.resolve();
        return signingIn.promise;
      },
    );
    await entered.promise;
    // The sign-in has no deadline; another sync of the same connector still completes.
    await runSavedImport(
      DEMO_ROOT,
      "spotify",
      "live",
      new AbortController().signal,
      update,
      async (cursor) => {
        order.push(`second run from ${cursor}`);
        return report("after-second");
      },
    );
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({ cursor: "after-second" });
    signingIn.resolve({ fetch: vi.fn<typeof fetch>() });
    await first;
    // The checkpoint is read inside the reservation, after sign-in, so it is never stale.
    expect(order).toEqual(["second run from undefined", "first run from after-second"]);
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({
      cursor: "after-first",
      lastOutcome: "ok",
    });
  });
  it("records nothing when sign-in is abandoned and records the start only after it succeeds", async () => {
    const [store] = preferencesPair();
    const update = updater(store, "spotify");
    const controller = new AbortController();
    const run = vi.fn();
    await expect(
      runSavedImport(DEMO_ROOT, "spotify", "live", controller.signal, update, run, async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(store.read(DEMO_WEBID).spotify).toBeUndefined();
    const auth = { fetch: vi.fn<typeof fetch>() };
    let duringSignIn: unknown = "unread";
    const report = await runSavedImport(
      DEMO_ROOT,
      "spotify",
      "live",
      new AbortController().signal,
      update,
      async (_cursor, connection, received) => {
        expect(received).toBe(auth);
        expect(connection.lastOutcome).toBe("incomplete");
        return {
          adapterId: "spotify",
          mode: "live",
          written: [],
          categories: [],
          indexUrl: `${DEMO_ROOT}index`,
        } satisfies ImportReport;
      },
      async () => {
        duringSignIn = store.read(DEMO_WEBID).spotify;
        return auth;
      },
    );
    expect(report.adapterId).toBe("spotify");
    expect(duringSignIn).toBeUndefined();
    expect(store.read(DEMO_WEBID).spotify).toMatchObject({ lastOutcome: "ok" });
  });
});

// AUTHORED-BY Claude Opus 5.5
describe("a sign-in that expires while waiting for the reservation", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const token = (expiresAt?: number, refreshToken?: string) => ({
    accessToken: "memory-only",
    tokenType: "Bearer",
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(refreshToken ? { refreshToken } : {}),
  });
  it("treats a token within 60 s of expiry as expired unless the adapter can refresh it", () => {
    expect(tokenStillUsable(token(), false, now)).toBe(true);
    expect(tokenStillUsable(token(now + 61_000), false, now)).toBe(true);
    expect(tokenStillUsable(token(now + 60_000), false, now)).toBe(false);
    expect(tokenStillUsable(token(now - 1), false, now)).toBe(false);
    expect(tokenStillUsable(token(now - 1, "refresh"), true, now)).toBe(true);
    // A refresh token is useless without an adapter that refreshes.
    expect(tokenStillUsable(token(now - 1, "refresh"), false, now)).toBe(false);
    expect(tokenStillUsable(token(now - 1), true, now)).toBe(false);
  });
  it("checks the sign-in inside the reservation and records nothing when it is no longer usable", async () => {
    const [store] = preferencesPair();
    const update = updater(store, "spotify");
    const run = vi.fn();
    const auth = { fetch: vi.fn<typeof fetch>() };
    const usable = vi.fn(() => false);
    await expect(
      runSavedImport(
        DEMO_ROOT,
        "spotify",
        "live",
        new AbortController().signal,
        update,
        run,
        async () => auth,
        { usable },
      ),
    ).rejects.toBeInstanceOf(SignInExpiredError);
    expect(usable).toHaveBeenCalledWith(auth);
    expect(run).not.toHaveBeenCalled();
    expect(store.read(DEMO_WEBID).spotify).toBeUndefined();
  });
});

describe("permissions without a matching collection", () => {
  const sync = async (id: string, selection: readonly string[]) => {
    const { session } = await setup();
    const adapter = createRegistry().adapterById(id);
    if (!adapter) throw new Error("Missing adapter");
    // Replays repeated routes in order, as the package's demo mode does.
    const source = { adapter, fetch: vi.fn(fixtureFetch(id, adapter.fixtures())) };
    const report = await runImport({
      adapter: withSelectedScopes(source.adapter, withRequiredScopes(id, selection)),
      mode: "live",
      sourceAuth: { fetch: source.fetch },
      podWriter: createImportWriter(session, id, new AbortController().signal),
    });
    const paths = source.fetch.mock.calls.map(([input]) => new URL(String(input)).pathname);
    const slugs = report.written.map(({ url }) =>
      url.slice(url.indexOf(`/${id}/`) + id.length + 2),
    );
    return { report, paths, slugs };
  };
  it.each([
    [["read:user"], ["work/profile.ttl"], false],
    [["repo"], ["work/repositories.ttl"], true],
  ] as const)("imports only the GitHub collection for %j", async (selection, slugs, repos) => {
    const result = await sync("github", selection);
    expect(result.slugs).toEqual(slugs);
    expect(result.paths.some((path) => path.endsWith("/user/repos"))).toBe(repos);
  });
  it("advances Strava's checkpoint without its unused profile permission", async () => {
    const full = await sync("strava", ["read", "activity:read"]);
    const withoutProfile = await sync("strava", ["activity:read"]);
    expect(full.report.cursor).toBeDefined();
    expect(withoutProfile.report.cursor).toBe(full.report.cursor);
    expect(withoutProfile.slugs).toEqual(full.slugs);
    const profileOnly = await sync("strava", ["read"]);
    expect(profileOnly.paths.some((path) => path.endsWith("/athlete/activities"))).toBe(false);
    expect(profileOnly.report.cursor).toBeUndefined();
  });
  it("treats a withheld scope without a rule as partial and keeps the previous checkpoint", async () => {
    const { session } = await setup();
    const base = createRegistry().adapterById("strava");
    if (!base) throw new Error("Missing adapter");
    // A new permission the host has no rule for yet: it may gate data this run omits.
    const adapter = {
      ...base,
      metadata: { ...base.metadata, scopes: [...base.metadata.scopes, "profile:read_all"] },
    };
    const run = (selection: readonly string[], cursor?: string) =>
      runImport({
        adapter: withSelectedScopes(adapter, selection),
        mode: "live",
        sourceAuth: { fetch: vi.fn(fixtureFetch("strava", adapter.fixtures())) },
        podWriter: createImportWriter(session, "strava", new AbortController().signal),
        ...(cursor ? { cursor } : {}),
      });
    const full = await run(adapter.metadata.scopes);
    expect(full.cursor).toBeDefined();
    expect((await run(["read", "activity:read"])).cursor).toBeUndefined();
    expect((await run(["read", "activity:read"], "kept")).cursor).toBe("kept");
    // Only the listed no-data scope can be withheld without making the run partial.
    expect((await run(["activity:read", "profile:read_all"])).cursor).toBe(full.cursor);
  });
  it("requires Dropbox's account permission and advances only with file details", async () => {
    expect(withRequiredScopes("dropbox", [])).toEqual(["account_info.read"]);
    const files = await sync("dropbox", ["files.metadata.read"]);
    expect(files.report.cursor).toBeDefined();
    expect(files.slugs).toContain("documents/files.ttl");
    const none = await sync("dropbox", []);
    expect(none.paths.some((path) => path.includes("/files/"))).toBe(false);
    expect(none.report.cursor).toBeUndefined();
  });
});

describe("required identity permissions", () => {
  it.each([
    ["discord", []],
    ["discord", ["guilds"]],
    ["reddit", []],
    ["reddit", ["history"]],
    ["reddit", ["mysubreddits"]],
    ["reddit", ["history", "mysubreddits"]],
  ] as const)("authenticates every request allowed by %s selection %j", async (id, selected) => {
    const { session } = await setup();
    const source = fixtureTransport(id);
    const granted = withRequiredScopes(id, selected);
    const requested: string[] = [];
    const enforced: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const required =
        id === "discord"
          ? path.endsWith("/guilds")
            ? "guilds"
            : "identify"
          : path.endsWith("/saved")
            ? "history"
            : path.endsWith("/subscriber")
              ? "mysubreddits"
              : "identity";
      expect(granted).toContain(required);
      requested.push(required);
      if (!granted.includes(required)) return new Response(null, { status: 403 });
      return source.fetch(input, init);
    };
    await runImport({
      adapter: withSelectedScopes(source.adapter, granted),
      mode: "live",
      sourceAuth: { fetch: enforced },
      podWriter: createImportWriter(session, id, new AbortController().signal),
    });
    expect(requested).toContain(id === "discord" ? "identify" : "identity");
    for (const scope of selected) expect(requested).toContain(scope);
  });
});
