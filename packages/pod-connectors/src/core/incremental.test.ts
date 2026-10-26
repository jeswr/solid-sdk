// AUTHORED-BY Codex GPT-6.1-Sol
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
import type { ConnectorState, ImportContext, IntegrationAdapter, PodWriter } from "./types.js";
import { CLASSES, DataCollection, MusicPlaylist, MusicRecording } from "./vocab.js";

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

  it("replaces incoming item descriptions by deterministic subject and preserves unseen items without mutating inputs", () => {
    const old = new Store();
    song(old, "https://pod.test/items#old", "same", "Old");
    song(old, "https://pod.test/items#kept", "kept", "Kept");
    const next = new Store();
    song(next, "https://pod.test/items#old", "same", "New");
    const merged = mergeItems(old, next);
    expect(new MusicRecording("https://pod.test/items#old", merged, DataFactory).name).toBe("New");
    expect(new MusicRecording("https://pod.test/items#kept", merged, DataFactory).name).toBe(
      "Kept",
    );
    expect(new MusicRecording("https://pod.test/items#old", old, DataFactory).name).toBe("Old");
    expect(copyDataset().size).toBe(0);
    expect(copyDataset(next)).not.toBe(next);
  });

  it("preserves distinct subjects sharing an identifier within and across incremental pages", () => {
    const incoming = new Store();
    song(incoming, "https://pod.test/items#first", "one", "First");
    song(incoming, "https://pod.test/items#last", "one", "Last");
    const result = mergeItems(undefined, incoming);
    expect(
      [...result].filter((q) => q.predicate.value === "https://schema.org/identifier"),
    ).toHaveLength(2);
    expect(new MusicRecording("https://pod.test/items#first", result, DataFactory).name).toBe(
      "First",
    );
    const next = new Store();
    song(next, "https://pod.test/items#last", "one", "Updated");
    const merged = mergeItems(result, next);
    expect(new MusicRecording("https://pod.test/items#first", merged, DataFactory).name).toBe(
      "First",
    );
    expect(new MusicRecording("https://pod.test/items#last", merged, DataFactory).name).toBe(
      "Updated",
    );
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
        writeMode: "merge",
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

  for (const kind of ["api", "file"] as const) {
    for (const page of ["item-only", "empty", "collection"] as const) {
      it(`preserves absent collection metadata and replaces explicit metadata on ${kind} ${page} merges`, async () => {
        const pod = createMemoryPod();
        const port = writer(pod);
        const url = port.resolve("items.ttl");
        const existing = new Store();
        const collection = new DataCollection(url, existing, DataFactory).mark();
        collection.name = "Existing collection";
        song(existing, `${url}#old`, "old", "Existing item");
        const previousActivity = "urn:synthetic:previous-run";
        for (const subject of [url, `${url}#old`]) {
          const provenance = new Provenance(subject, existing, DataFactory);
          provenance.generatedBy.add(previousActivity);
          provenance.derivedFrom.add("https://source.test/previous");
        }
        await port.write({
          slug: "items.ttl",
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset: existing,
        });
        const incoming = new Store();
        if (page !== "empty") song(incoming, `${url}#new`, "new", "New item");
        if (page === "collection") {
          const replacement = new MusicPlaylist(url, incoming, DataFactory).mark();
          replacement.name = "Updated collection";
        }
        const original = copyDataset(incoming);
        const importPage = async (ctx: Pick<ImportContext, "write">) => {
          await ctx.write({
            slug: "items.ttl",
            category: "media",
            forClass: CLASSES.MusicRecording,
            dataset: incoming,
            writeMode: "merge",
            sourceUrl: "https://source.test/current",
          });
          return {};
        };
        const source = adapter(importPage);
        const report =
          kind === "api"
            ? await runImport({ adapter: source, podWriter: port, mode: "demo" })
            : await runFileImport({
                adapter: {
                  metadata: source.metadata,
                  accept: ".txt",
                  fileHint: "Synthetic file",
                  async importFile(_file, ctx) {
                    await importPage(ctx);
                  },
                },
                podWriter: port,
                file: memoryFile("synthetic.txt", "fixture"),
              });
        const result = pod.dataset(url);
        const document = new Provenance(url, result, DataFactory);
        expect(document.name).toBe(
          page === "collection" ? "Updated collection" : "Existing collection",
        );
        expect(document.types.has(CLASSES.Dataset)).toBe(page !== "collection");
        expect(document.types.has(CLASSES.MusicPlaylist)).toBe(page === "collection");
        expect(document.derivedFrom.has("https://source.test/current")).toBe(true);
        expect(document.generatedBy.size).toBe(1);
        expect(document.generatedBy.has(previousActivity)).toBe(false);
        const activityUrl = [...document.generatedBy][0] ?? "";
        expect(
          new Provenance(
            activityUrl,
            pod.dataset(port.resolve("_provenance.ttl")),
            DataFactory,
          ).types.has(`${PROV}Activity`),
        ).toBe(true);
        const oldItem = new Provenance(`${url}#old`, result, DataFactory);
        expect(oldItem.name).toBe("Existing item");
        expect([...oldItem.generatedBy]).toEqual([previousActivity]);
        if (page !== "empty") {
          const newItem = new Provenance(`${url}#new`, result, DataFactory);
          expect(newItem.name).toBe("New item");
          expect([...newItem.generatedBy]).toEqual([activityUrl]);
          expect(newItem.derivedFrom.has("https://source.test/songs/new")).toBe(true);
          expect(document.derivedFrom.has("https://source.test/songs/new")).toBe(true);
        }
        expect(report.state?.counts.items).toBe(page === "empty" ? 0 : 1);
        expect(incoming.size).toBe(original.size);
        for (const quad of original) expect(incoming.has(quad)).toBe(true);
      });
    }
  }

  for (const snapshot of [
    {
      source: spotifyAdapter,
      slug: "music/playlists.ttl",
      route: "https://api.spotify.com/v1/me/playlists",
      payload: (ids: string[]) => ({ items: ids.map((id) => ({ id, name: id })) }),
    },
    {
      source: githubAdapter,
      slug: "work/repositories.ttl",
      route: "https://api.github.com/user/repos",
      payload: (ids: string[]) => ids.map((id) => ({ id, name: id })),
    },
  ]) {
    it(`replaces ${snapshot.source.metadata.id} snapshots, including an empty collection`, async () => {
      let ids = ["A", "B"];
      const source = {
        ...snapshot.source,
        fixtures: () =>
          snapshot.source
            .fixtures()
            .map((route) =>
              route.url === snapshot.route ? { ...route, json: snapshot.payload(ids) } : route,
            ),
      };
      const { pod } = await demoImport(source);
      const url = `${TEST_POD_ROOT}integrations/${source.metadata.id}/${snapshot.slug}`;
      const itemIds = () =>
        [...pod.dataset(url)]
          .filter((q) => q.predicate.value === "https://schema.org/identifier")
          .map((q) => q.object.value)
          .sort();
      expect(itemIds()).toEqual(["A", "B"]);
      ids = ["B"];
      await demoImport(source, { pod });
      expect(itemIds()).toEqual(["B"]);
      ids = [];
      await demoImport(source, { pod });
      expect(itemIds()).toEqual([]);
    });
  }

  for (const writeMode of [undefined, "replace"] as const) {
    it(`honours deletions from a read dataset with ${writeMode ?? "default"} writes`, async () => {
      const pod = createMemoryPod();
      const port = writer(pod);
      const url = port.resolve("items.ttl");
      const dataset = new Store();
      song(dataset, `${url}#removed`, "removed", "Removed");
      song(dataset, `${url}#kept`, "kept", "Kept");
      await port.write({
        slug: "items.ttl",
        category: "media",
        forClass: CLASSES.MusicRecording,
        dataset,
      });
      const source = adapter(async (ctx) => {
        const edited = copyDataset(await ctx.read("items.ttl"));
        for (const quad of [...edited])
          if (quad.subject.value === `${url}#removed`) edited.delete(quad);
        await ctx.write({
          slug: "items.ttl",
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset: edited,
          writeMode,
        });
        return {};
      });
      await runImport({ adapter: source, podWriter: port, mode: "demo" });
      const result = pod.dataset(url);
      expect(new MusicRecording(`${url}#removed`, result, DataFactory).name).toBeUndefined();
      expect(new MusicRecording(`${url}#kept`, result, DataFactory).name).toBe("Kept");
      expect((await port.read("items.ttl"))?.etag).toBe('"v2"');
    });
  }

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

  it("merges on servers without ETags and honours an explicit source-document fallback", async () => {
    const base = writer();
    const original = new Store();
    song(original, `${base.resolve("items.ttl")}#old`, "old", "Kept");
    await base.write({
      slug: "items.ttl",
      category: "media",
      forClass: CLASSES.MusicRecording,
      dataset: original,
    });
    const conditions: unknown[] = [];
    const port: PodWriter = {
      ...base,
      async read(slug) {
        const existing = await base.read(slug);
        return existing ? { ...existing, etag: null } : undefined;
      },
      async write(doc, condition) {
        conditions.push(condition);
        return base.write(doc, condition);
      },
    };
    const source = adapter(async (ctx) => {
      const dataset = new Store();
      const item = new MusicRecording(
        `${ctx.resolve("items.ttl")}#new`,
        dataset,
        DataFactory,
      ).mark();
      item.identifier = "new";
      item.name = "No individual URL";
      await ctx.write({
        slug: "items.ttl",
        category: "media",
        forClass: CLASSES.MusicRecording,
        writeMode: "merge",
        dataset,
        sourceUrl: "https://source.test/export",
      });
      return {};
    });
    await runImport({ adapter: source, podWriter: port, mode: "demo" });
    expect(conditions[0]).toBeUndefined();
    const result = await base.read("items.ttl");
    const item = new Provenance(
      `${port.resolve("items.ttl")}#new`,
      result?.dataset ?? new Store(),
      DataFactory,
    );
    expect(item.derivedFrom.has("https://source.test/export")).toBe(true);
    expect(
      new MusicRecording(
        `${port.resolve("items.ttl")}#old`,
        result?.dataset ?? new Store(),
        DataFactory,
      ).name,
    ).toBe("Kept");
  });

  it("reports a first-run failure without persisting source error text or a checkpoint", async () => {
    const states: ConnectorState[] = [];
    const source = adapter(async () => {
      throw new Error("synthetic-private-source-detail");
    });
    await expect(
      runImport({
        adapter: source,
        podWriter: writer(),
        mode: "demo",
        onState: (state) => states.push(state),
      }),
    ).rejects.toThrow("synthetic-private-source-detail");
    expect(states[0]).toMatchObject({
      lastOutcome: "error",
      counts: { documents: 0, items: 0, skipped: 0 },
    });
    expect(states[0]?.lastSync).toBeUndefined();
    expect(states[0]?.cursor).toBeUndefined();
    expect(JSON.stringify(states)).not.toContain("synthetic-private-source-detail");
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

  it.each([
    "api",
    "file",
  ])("retains every class registration across repeated %s writes to one document", async (kind) => {
    const pod = createMemoryPod();
    const port = writer(pod);
    const importWrites = async (ctx: Pick<ImportContext, "resolve" | "write">) => {
      const url = ctx.resolve("music/items.ttl");
      const recording = new Store();
      song(recording, `${url}#song`, "song", "Song");
      const playlist = new Store();
      new MusicPlaylist(`${url}#playlist`, playlist, DataFactory).mark();
      for (const [forClass, dataset, skipRegistration] of [
        [CLASSES.MusicRecording, recording, false],
        [CLASSES.MusicPlaylist, playlist, false],
        [CLASSES.MusicRecording, recording, false],
        [CLASSES.Person, new Store(), true],
      ] as const) {
        await ctx.write({
          slug: "music/items.ttl",
          category: "media",
          forClass,
          dataset,
          skipRegistration,
          writeMode: "merge",
        });
      }
      return {};
    };
    const source = adapter(importWrites);
    const report =
      kind === "api"
        ? await runImport({ adapter: source, podWriter: port, mode: "demo" })
        : await runFileImport({
            adapter: {
              metadata: source.metadata,
              accept: ".txt",
              fileHint: "Synthetic file",
              async importFile(_file, ctx) {
                await importWrites(ctx);
              },
            },
            podWriter: port,
            file: memoryFile("synthetic.txt", "fixture"),
          });
    expect(report.written).toHaveLength(1);
    expect(report.state?.counts.documents).toBe(1);
    const dataset = pod.dataset(port.resolve("music/items.ttl"));
    expect(
      new MusicRecording(`${port.resolve("music/items.ttl")}#song`, dataset, DataFactory).types.has(
        CLASSES.MusicRecording,
      ),
    ).toBe(true);
    expect(
      new MusicPlaylist(
        `${port.resolve("music/items.ttl")}#playlist`,
        dataset,
        DataFactory,
      ).types.has(CLASSES.MusicPlaylist),
    ).toBe(true);
    const index = pod.dataset(report.indexUrl);
    expect(
      [...index]
        .filter((q) => q.predicate.value === "http://www.w3.org/ns/solid/terms#forClass")
        .map((q) => q.object.value)
        .sort(),
    ).toEqual([CLASSES.MusicRecording, CLASSES.MusicPlaylist].sort());
    expect(
      [...index]
        .filter((q) => q.predicate.value === "http://www.w3.org/ns/solid/terms#instanceContainer")
        .map((q) => q.object.value),
    ).toEqual([port.resolve("music/"), port.resolve("music/")]);
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
          writeMode: "merge",
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
      expect(new Provenance(doc.url, ds, DataFactory).derivedFrom.has(item.sourceUrl ?? "")).toBe(
        true,
      );
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
        writeMode: "merge",
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
