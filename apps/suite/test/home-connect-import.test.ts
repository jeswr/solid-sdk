// AUTHORED-BY Codex GPT-6
import {
  createRegistry,
  fileAdapterById,
  type ImportReport,
  runFileImport,
  runImport,
} from "@jeswr/pod-connectors";
import { memoryFile } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  createImportWriter,
  fetchWithSignal,
  fileWithSignal,
  runSavedImport,
} from "../src/apps/home/components/connect/import-service";
import { withRequiredScopes, withSelectedScopes } from "../src/apps/home/components/connect/scopes";
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
function preferencesPair() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  return [createConnectorPreferences(storage), createConnectorPreferences(storage)] as const;
}
function updater(store: ReturnType<typeof createConnectorPreferences>, id: string) {
  return (action: ConnectionAction) => {
    const connections = store.read(DEMO_WEBID);
    const next = connectionReducer(connections[id], action);
    store.write(DEMO_WEBID, { ...connections, [id]: next });
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
