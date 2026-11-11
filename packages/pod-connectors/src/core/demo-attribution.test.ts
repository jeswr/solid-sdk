// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { fixtureFetch } from "./fixture-fetch.js";
import { adapterContainerUrl, createSourceAuth, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { IntegrationAdapter } from "./types.js";
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

describe("explicit demo attribution", () => {
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

  it("keeps attribution opt-in for a fixtureless demo adapter", async () => {
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
      expect(dataset.match(null, DataFactory.namedNode(`${NS.PROV}wasAttributedTo`)).size).toBe(0);
    }
  });
});
