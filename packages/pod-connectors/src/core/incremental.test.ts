// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { githubAdapter } from "../github/adapter.js";
import { spotifyAdapter } from "../spotify/adapter.js";
import { FEDERATION } from "./federation-vocab.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { copyDataset, mergeItems } from "./incremental.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { PROV, Provenance } from "./provenance.js";
import {
  createMemoryPod,
  demoImport,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { ConnectorState, IntegrationAdapter, PodWriter } from "./types.js";
import { CLASSES, MusicRecording } from "./vocab.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
function song(dataset: Store, subject: string, id: string, name: string) {
  const item = new MusicRecording(subject, dataset, DataFactory).mark();
  item.identifier = id;
  item.name = name;
  item.sourceUrl = `https://source.test/songs/${id}`;
  return item;
}
function writer(pod = createMemoryPod(), id = "incremental") {
  return createFetchPodWriter({
    adapterId: id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
}
function adapter(importer: IntegrationAdapter["import"]): IntegrationAdapter {
  return {
    ...spotifyAdapter,
    metadata: { ...spotifyAdapter.metadata, id: "incremental" },
    import: importer,
  };
}

describe("CON-02 incremental writes", () => {
  for (const source of [spotifyAdapter, githubAdapter]) {
    it(`re-imports ${source.metadata.id} without duplicate items or resources`, async () => {
      const { pod, report } = await demoImport(source);
      const urls = pod.urls();
      const sizes = report.written.map((doc) => pod.dataset(doc.url).size);
      const second = await demoImport(source, { pod });
      expect(second.report.written).toEqual(report.written);
      expect(pod.urls()).toEqual(urls);
      expect(report.written.map((doc) => pod.dataset(doc.url).size)).toEqual(sizes);
      for (const doc of report.written) {
        const ds = pod.dataset(doc.url);
        const ids = [...ds]
          .filter((q) => q.predicate.value === "https://schema.org/identifier")
          .map((q) => q.object.value);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  }

  it("replaces incoming item descriptions by ID and preserves unseen items without mutating inputs", () => {
    const old = new Store();
    song(old, "https://pod.test/items#old", "same", "Old");
    song(old, "https://pod.test/items#kept", "kept", "Kept");
    const next = new Store();
    song(next, "https://pod.test/items#new", "same", "New");
    const merged = mergeItems(old, next);
    expect(
      new MusicRecording("https://pod.test/items#old", merged, DataFactory).name,
    ).toBeUndefined();
    expect(new MusicRecording("https://pod.test/items#new", merged, DataFactory).name).toBe("New");
    expect(new MusicRecording("https://pod.test/items#kept", merged, DataFactory).name).toBe(
      "Kept",
    );
    expect(new MusicRecording("https://pod.test/items#old", old, DataFactory).name).toBe("Old");
    expect(copyDataset().size).toBe(0);
    expect(copyDataset(next)).not.toBe(next);
  });

  it("deduplicates repeated item IDs within an incoming page with the last description winning", () => {
    const incoming = new Store();
    song(incoming, "https://pod.test/items#first", "one", "First");
    song(incoming, "https://pod.test/items#last", "one", "Last");
    const result = mergeItems(undefined, incoming);
    expect(
      [...result].filter((q) => q.predicate.value === "https://schema.org/identifier"),
    ).toHaveLength(1);
    expect(new MusicRecording("https://pod.test/items#last", result, DataFactory).name).toBe(
      "Last",
    );
    expect(new MusicRecording("https://pod.test/items#first", incoming, DataFactory).name).toBe(
      "First",
    );
  });

  it("continues from host state and merges a new page automatically", async () => {
    const pod = createMemoryPod();
    const port = writer(pod);
    const source = adapter(async (ctx) => {
      const dataset = new Store();
      const url = ctx.resolve("items.ttl");
      if (!ctx.cursor) {
        song(dataset, `${url}#one`, "one", "Before");
        song(dataset, `${url}#two`, "two", "Untouched");
      } else {
        expect(ctx.cursor).toBe("page-two");
        song(dataset, `${url}#one`, "one", "After");
        song(dataset, `${url}#three`, "three", "New");
      }
      await ctx.write({
        slug: "items.ttl",
        category: "media",
        forClass: CLASSES.MusicRecording,
        dataset,
      });
      return { cursor: ctx.cursor ? "page-three" : "page-two", skipped: 1 };
    });
    const first = await runImport({ adapter: source, podWriter: port, mode: "demo" });
    const states: ConnectorState[] = [];
    const second = await runImport({
      adapter: source,
      podWriter: port,
      mode: "demo",
      state: first.state,
      onState: (state) => states.push(state),
    });
    expect(second.state).toMatchObject({
      connectedAt: first.state?.connectedAt,
      cursor: "page-three",
      lastOutcome: "success",
      counts: { documents: 1, items: 2, skipped: 1 },
    });
    expect(states).toEqual([second.state]);
    const ds = pod.dataset(port.resolve("items.ttl"));
    expect(new MusicRecording(`${port.resolve("items.ttl")}#one`, ds, DataFactory).name).toBe(
      "After",
    );
    expect(new MusicRecording(`${port.resolve("items.ttl")}#two`, ds, DataFactory).name).toBe(
      "Untouched",
    );
    expect(
      [...ds].filter((q) => q.predicate.value === "https://schema.org/identifier"),
    ).toHaveLength(3);
  });

  it("keeps the successful checkpoint on a source, registration or provenance failure", async () => {
    const previous: ConnectorState = {
      connectedAt: "2026-01-01T00:00:00Z",
      lastSync: "2026-01-02T00:00:00Z",
      cursor: "resume",
      lastOutcome: "success",
      counts: { documents: 2, items: 4, skipped: 0 },
    };
    for (const stage of ["source", "registration", "provenance"]) {
      const states: ConnectorState[] = [];
      const base = writer();
      const port: PodWriter = {
        ...base,
        registerType:
          stage === "registration"
            ? async () => {
                throw new Error("fixture failure");
              }
            : base.registerType,
        write:
          stage === "provenance"
            ? async () => {
                throw new Error("fixture failure");
              }
            : base.write,
      };
      const source = adapter(async () => {
        if (stage === "source") throw new Error("fixture failure");
        return { cursor: "must-not-persist" };
      });
      await expect(
        runImport({
          adapter: source,
          podWriter: port,
          mode: "demo",
          state: previous,
          onState: (state) => states.push(state),
        }),
      ).rejects.toThrow("fixture failure");
      expect(states).toEqual([{ ...previous, lastOutcome: "error" }]);
    }
  });

  it("reserves the activity document, including query and fragment aliases", async () => {
    for (const slug of ["_provenance.ttl", "_provenance.ttl#alias", "_provenance.ttl?alias"]) {
      const port = writer();
      const source = adapter(async (ctx) => {
        await ctx.write({
          slug,
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset: new Store(),
        });
        return {};
      });
      await expect(runImport({ adapter: source, podWriter: port, mode: "demo" })).rejects.toThrow(
        "Reserved connector provenance slug",
      );
    }
  });

  it("re-reads between writes of the same slug and uses the newest ETag", async () => {
    const port = writer();
    const source = adapter(async (ctx) => {
      for (const id of ["one", "two"]) {
        const dataset = new Store();
        song(dataset, `${ctx.resolve("items.ttl")}#${id}`, id, id);
        await ctx.write({
          slug: "items.ttl",
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset,
        });
      }
      return {};
    });
    const report = await runImport({ adapter: source, podWriter: port, mode: "demo" });
    expect(report.written).toHaveLength(1);
    expect((await port.read("items.ttl"))?.etag).toBe('"v2"');
  });
});

it("records one complete PROV activity per run and each source-item derivation", async () => {
  const { pod, report } = await demoImport(spotifyAdapter);
  const root = `${TEST_POD_ROOT}integrations/spotify/`;
  const provenance = pod.dataset(`${root}_provenance.ttl`);
  const activities = [...provenance].filter(
    (q) => q.predicate.value === RDF_TYPE && q.object.value === `${PROV}Activity`,
  );
  expect(activities).toHaveLength(1);
  const activityUrl = activities[0]?.subject.value ?? "";
  const activity = new Provenance(activityUrl, provenance, DataFactory);
  expect(activity.associatedWith).toBe("urn:solid:connector:spotify");
  expect(activity.used.has("https://api.spotify.com/")).toBe(true);
  expect(activity.startedAt).toBeInstanceOf(Date);
  expect(activity.endedAt?.getTime()).toBeGreaterThanOrEqual(activity.startedAt?.getTime() ?? 0);
  for (const doc of report.written) {
    const ds = pod.dataset(doc.url);
    expect(new Provenance(doc.url, ds, DataFactory).generatedBy.has(activityUrl)).toBe(true);
    const items = new Set(
      [...ds]
        .filter((q) => q.predicate.value === "https://schema.org/identifier")
        .map((q) => q.subject.value),
    );
    for (const subject of items) {
      const item = new Provenance(subject, ds, DataFactory);
      expect(item.derivedFrom.has(item.sourceUrl ?? "")).toBe(true);
      expect(item.generatedBy.has(activityUrl)).toBe(true);
      if (item.types.has(CLASSES.MusicRecording))
        expect(item.types.has(FEDERATION.MusicRecording)).toBe(true);
      if (item.types.has(CLASSES.MusicPlaylist))
        expect(item.types.has(FEDERATION.Playlist)).toBe(true);
    }
  }
  await demoImport(spotifyAdapter, { pod });
  expect(
    [...pod.dataset(`${root}_provenance.ttl`)].filter(
      (q) => q.predicate.value === RDF_TYPE && q.object.value === `${PROV}Activity`,
    ),
  ).toHaveLength(2);
  expect(pod.get(report.indexUrl)).not.toContain(`${PROV}Activity`);
});

it("shares merge, provenance and host state with file imports", async () => {
  const pod = createMemoryPod();
  const port = writer(pod);
  const source = {
    metadata: {
      ...spotifyAdapter.metadata,
      id: "incremental",
      tier: "C" as const,
      authKind: "export-file" as const,
    },
    accept: ".txt",
    fileHint: "Synthetic file",
    async importFile(_file: unknown, ctx: import("./file-import.js").FileImportContext) {
      const dataset = new Store();
      song(dataset, `${ctx.resolve("items.ttl")}#one`, "one", "File");
      await ctx.write({
        slug: "items.ttl",
        category: "media",
        forClass: CLASSES.MusicRecording,
        dataset,
      });
    },
  };
  const first = await runFileImport({
    adapter: source,
    podWriter: port,
    file: memoryFile("synthetic.txt", "fixture"),
  });
  const next = await runFileImport({
    adapter: source,
    podWriter: port,
    file: memoryFile("synthetic.txt", "fixture"),
    state: first.state,
  });
  expect(next.state?.connectedAt).toBe(first.state?.connectedAt);
  expect(next.state?.counts).toEqual({ documents: 1, items: 1, skipped: 0 });
  const doc = new Provenance(
    port.resolve("items.ttl"),
    pod.dataset(port.resolve("items.ttl")),
    DataFactory,
  );
  expect(doc.derivedFrom.has("urn:solid:connector:incremental:export")).toBe(true);
});
