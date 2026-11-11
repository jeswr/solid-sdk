// AUTHORED-BY Codex GPT-6.1-Sol
import { DEMO_CONNECTOR, NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { adapterContainerUrl, createSourceAuth, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { IntegrationAdapter, NormalisedDoc } from "./types.js";
import { CLASSES, MusicRecording, PodThing } from "./vocab.js";

const agent = { iri: `${NS.AGENT}synthetic-demo-test`, label: "Sample data" };
const adapter: IntegrationAdapter = {
  metadata: {
    id: "demo-marker",
    name: "Marker test",
    tier: "A",
    authKind: "none",
    scopes: [],
    categories: ["media"],
    whatYouGet: "Synthetic items",
    requirements: [],
  },
  fixtures: () => [{ url: "https://source.example/items", json: {} }],
  async import(ctx) {
    for (const slug of ["first.ttl", "second.ttl"]) {
      const dataset = new Store();
      for (const fragment of ["it", "second"]) {
        const item = new MusicRecording(
          `${ctx.resolve(slug)}#${fragment}`,
          dataset,
          DataFactory,
        ).mark();
        item.name = fragment;
        item.sourceUrl = "https://source.example/item";
      }
      new PodThing("https://source.example/person", dataset, DataFactory).name = "Source person";
      await ctx.write({ slug, dataset, category: "media", forClass: CLASSES.MusicRecording });
    }
    return {};
  },
};

function setup() {
  const pod = createMemoryPod();
  const writer = createFetchPodWriter({
    adapterId: adapter.metadata.id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const url = writer.resolve("items.ttl");
  const subject = (id: string) => `${url}#${id}`;
  async function run(
    mode: "demo" | "live",
    ids: string[],
    writeMode?: NormalisedDoc["writeMode"],
    carried: string[] = [],
  ) {
    return runImport({
      adapter: {
        ...adapter,
        async import(ctx) {
          const dataset = new Store();
          const stored = await ctx.read("items.ttl");
          for (const id of carried)
            for (const quad of stored?.match(DataFactory.namedNode(subject(id))) ?? [])
              dataset.add(quad);
          for (const id of ids)
            new MusicRecording(subject(id), dataset, DataFactory).mark().name = id;
          await ctx.write({
            slug: "items.ttl",
            category: "media",
            forClass: CLASSES.MusicRecording,
            dataset,
            writeMode,
            carriedForward: carried.map(subject),
          });
          return {};
        },
      },
      mode,
      podWriter: writer,
      sourceAuth: { fetch: fixtureFetch(adapter.metadata.id, adapter.fixtures()) },
    });
  }
  const item = (id: string) => new Provenance(subject(id), pod.dataset(url), DataFactory);
  const marked = (id: string) => item(id).attributedTo.has(DEMO_CONNECTOR.iri);
  return { pod, writer, url, run, marked, item };
}

describe("demo attribution", () => {
  it.each(["demo", "live"] as const)("marks every imported item only in %s mode", async (mode) => {
    const pod = createMemoryPod();
    const writer = createFetchPodWriter({
      adapterId: adapter.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    const options = {
      adapter: {
        ...adapter,
        async import(ctx) {
          await ctx.api("https://source.example/items");
          return adapter.import(ctx);
        },
      } satisfies IntegrationAdapter,
      podWriter: writer,
      mode,
      demoAgent: agent,
      sourceAuth: createSourceAuth(
        adapter.metadata.id,
        adapter,
        { accessToken: "synthetic-token", tokenType: "Bearer" },
        fixtureFetch(adapter.metadata.id, adapter.fixtures()),
      ),
    };
    const report = await runImport(options);
    expect(report.state?.counts.items).toBe(4);
    expect(report.written.map(({ url }) => url)).toEqual([
      `${adapterContainerUrl(TEST_POD_ROOT, adapter.metadata.id)}first.ttl`,
      `${adapterContainerUrl(TEST_POD_ROOT, adapter.metadata.id)}second.ttl`,
    ]);
    for (const { url } of report.written) {
      const dataset = pod.dataset(url);
      for (const fragment of ["it", "second"]) {
        const item = new Provenance(`${url}#${fragment}`, dataset, DataFactory);
        expect(item.attributedTo.has(agent.iri)).toBe(mode === "demo");
        expect(item.derivedFrom.has("https://source.example/item")).toBe(true);
      }
      expect(new PodThing(agent.iri, dataset, DataFactory).name).toBe(
        mode === "demo" ? agent.label : undefined,
      );
      expect(
        new Provenance("https://source.example/person", dataset, DataFactory).attributedTo.size,
      ).toBe(0);
    }
    const again = await runImport(options);
    expect(again.written.map(({ url }) => url)).toEqual(report.written.map(({ url }) => url));
    expect(again.state?.counts.items).toBe(4);
    // Demo metadata never changes registered collections or resource identities.
    expect(again.indexUrl).toBe(report.indexUrl);
  });

  it("uses the declared default agent even for a fixtureless demo adapter", async () => {
    const pod = createMemoryPod();
    const writer = createFetchPodWriter({
      adapterId: adapter.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    const report = await runImport({
      adapter: { ...adapter, fixtures: () => [] },
      mode: "demo",
      podWriter: writer,
    });
    expect(report.state?.counts.items).toBe(4);
    for (const { url } of report.written) {
      const dataset = pod.dataset(url);
      expect(dataset.match(null, DataFactory.namedNode(`${NS.PROV}wasAttributedTo`)).size).toBe(2);
      expect(
        new Provenance(`${url}#it`, dataset, DataFactory).attributedTo.has(DEMO_CONNECTOR.iri),
      ).toBe(true);
      expect(new PodThing(DEMO_CONNECTOR.iri, dataset, DataFactory).name).toBe(
        DEMO_CONNECTOR.label,
      );
    }
  });

  it("does not mark live subjects carried forward into a demo replacement", async () => {
    const { run, marked, item } = setup();
    await run("live", ["live"]);
    const report = await run("demo", ["demo"], "replace", ["live"]);
    expect(report.state?.counts.items).toBe(1);
    expect(item("live").name).toBe("live");
    expect(marked("live")).toBe(false);
    expect(marked("demo")).toBe(true);
  });

  it("marks only new demo items when merging after live data", async () => {
    const { run, marked, item } = setup();
    await run("live", ["live"]);
    await run("demo", ["demo"], "merge");
    expect(item("live").name).toBe("live");
    expect(marked("live")).toBe(false);
    expect(marked("demo")).toBe(true);
  });

  it("preserves old demo markers when merging new live items", async () => {
    const { run, marked, item } = setup();
    await run("demo", ["demo"]);
    await run("live", ["live"], "merge");
    expect(item("demo").name).toBe("demo");
    expect(marked("demo")).toBe(true);
    expect(marked("live")).toBe(false);
  });

  it("removes the demo marker when a live snapshot replaces the same item", async () => {
    const { run, marked, pod, url } = setup();
    await run("demo", ["same"]);
    expect(marked("same")).toBe(true);
    await run("live", ["same"], "replace");
    expect(marked("same")).toBe(false);
    expect(new MusicRecording(`${url}#same`, pod.dataset(url), DataFactory).name).toBe("same");
    expect(pod.dataset(url).match(DataFactory.namedNode(DEMO_CONNECTOR.iri)).size).toBe(0);
  });

  it("does not describe the demo agent in a document containing only carried-forward live items", async () => {
    const { run, marked, pod, url } = setup();
    await run("live", ["live"]);
    const report = await run("demo", [], "replace", ["live"]);
    expect(report.state?.counts.items).toBe(0);
    expect(marked("live")).toBe(false);
    expect(pod.dataset(url).match(DataFactory.namedNode(DEMO_CONNECTOR.iri)).size).toBe(0);
  });

  it.each([
    "empty",
    "external",
    "document",
  ])("does not describe the agent when no local items were marked (%s)", async (content) => {
    const { pod, writer, url } = setup();
    await runImport({
      adapter: {
        ...adapter,
        async import(ctx) {
          const dataset = new Store();
          if (content === "external")
            new PodThing("https://source.example/person", dataset, DataFactory).name =
              "Source person";
          if (content === "document") new PodThing(url, dataset, DataFactory).name = "Document";
          await ctx.write({
            slug: "items.ttl",
            dataset,
            category: "media",
            forClass: CLASSES.MusicRecording,
          });
          return {};
        },
      },
      mode: "demo",
      podWriter: writer,
    });
    const dataset = pod.dataset(url);
    expect(dataset.match(null, DataFactory.namedNode(`${NS.PROV}wasAttributedTo`)).size).toBe(0);
    expect(dataset.match(DataFactory.namedNode(DEMO_CONNECTOR.iri)).size).toBe(0);
  });

  it.each([
    { iri: "", label: "Sample" },
    { iri: "relative", label: "Sample" },
    { iri: "/agent", label: "Sample" },
    { iri: "#agent", label: "Sample" },
    { iri: "http://source.example/agent", label: "Sample" },
    { iri: "urn:example:agent", label: "Sample" },
    { iri: "https:source.example", label: "Sample" },
    { iri: "https:///source.example/agent", label: "Sample" },
    { iri: "https://source.example/<agent>", label: "Sample" },
    { iri: "https://user@source.example/agent", label: "Sample" },
    { iri: "https://:password@source.example/agent", label: "Sample" },
    { iri: "https://source.example/agent", label: "" },
    { iri: "https://source.example/agent", label: "  " },
    { iri: "https://source.example/agent", label: undefined as unknown as string },
  ])("refuses an invalid demo agent before Pod I/O ($iri / $label)", async (demoAgent) => {
    const { pod, writer } = setup();
    const urls = pod.urls();
    await expect(
      runImport({ adapter, mode: "demo", podWriter: writer, demoAgent }),
    ).rejects.toThrow(IntegrationSyncError);
    expect(pod.urls()).toEqual(urls);
    // Validation must not retain the per-connector claim.
    await expect(runImport({ adapter, mode: "demo", podWriter: writer })).resolves.toMatchObject({
      mode: "demo",
    });
  });

  it("snapshots a custom agent before awaiting Pod reads", async () => {
    const { pod, writer } = setup();
    const demoAgent = { ...agent };
    const read = writer.read;
    writer.read = async (slug) => {
      demoAgent.iri = "relative";
      demoAgent.label = "Changed";
      return read(slug);
    };
    const report = await runImport({ adapter, mode: "demo", podWriter: writer, demoAgent });
    for (const { url } of report.written) {
      const dataset = pod.dataset(url);
      expect(new Provenance(`${url}#it`, dataset, DataFactory).attributedTo.has(agent.iri)).toBe(
        true,
      );
      expect(new PodThing(agent.iri, dataset, DataFactory).name).toBe(agent.label);
    }
  });
});
