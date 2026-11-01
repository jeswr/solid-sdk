// AUTHORED-BY Codex GPT-6
import { createRegistry, fileAdapterById, runFileImport, runImport } from "@jeswr/pod-connectors";
import { memoryFile } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  createImportWriter,
  fetchWithSignal,
  fileWithSignal,
} from "../src/apps/home/components/connect/import-service";
import { withSelectedScopes } from "../src/apps/home/components/connect/scopes";
import { provenanceOf } from "../src/apps/home/lib/model/provenance";
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
