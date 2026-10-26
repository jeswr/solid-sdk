// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { readTypeIndex, TypeIndexDataset } from "../pod/type-index.js";
import { ensureTypeRegistrations } from "../pod/type-index-write.js";
import { spotifyAdapter } from "../spotify/adapter.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { IntegrationAdapter, PodWriter } from "./types.js";
import { PodThing } from "./vocab.js";

describe("legacy Pod vocabulary", () => {
  it("normalizes custom PodWriter reads, retained merge items and prior provenance without mutating host data", async () => {
    const pod = createMemoryPod();
    const port = createFetchPodWriter({
      adapterId: "legacy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    const items = port.resolve("items.ttl");
    const runs = port.resolve("_provenance.ttl");
    for (const [url, body] of [
      [
        items,
        `<${items}#kept> a <https://w3id.org/jeswr/sectors/media#Track>;
        <https://w3id.org/jeswr/core#about> <https://source.test/synthetic-track> .`,
      ],
      [
        runs,
        `<${runs}#old> a <http://www.w3.org/ns/prov#Activity>, <https://w3id.org/jeswr/core#Activity>;
        <https://w3id.org/jeswr/core#about> <https://source.test/synthetic-run> .`,
      ],
    ])
      expect((await pod.fetch(url, { method: "PUT", body })).ok).toBe(true);

    const hostItems = pod.dataset(items);
    const hostRuns = pod.dataset(runs);
    const hostBefore = [...hostItems];
    const writer: PodWriter = {
      ...port,
      async read(slug) {
        const response = await pod.fetch(port.resolve(slug));
        if (response.status === 404) return undefined;
        return {
          dataset: slug === "_provenance.ttl" ? hostRuns : hostItems,
          etag: response.headers.get("etag") ?? undefined,
        };
      },
    };
    const adapter: IntegrationAdapter = {
      ...spotifyAdapter,
      metadata: { ...spotifyAdapter.metadata, id: "legacy" },
      async import(ctx) {
        const previous = await ctx.read("items.ttl");
        expect(
          new PodThing(`${items}#kept`, previous ?? new Store(), DataFactory).types.has(
            `${NS.MEDIA}Track`,
          ),
        ).toBe(true);
        const dataset = new Store();
        new PodThing(`${items}#new`, dataset, DataFactory).types.add(`${NS.MEDIA}Track`);
        await ctx.write({
          slug: "items.ttl",
          category: "media",
          forClass: `${NS.MEDIA}Track`,
          dataset,
          writeMode: "merge",
        });
        return { cursor: "next" };
      },
    };
    const report = await runImport({ adapter, podWriter: writer, mode: "demo" });
    expect(report.cursor).toBe("next");
    const dataset = pod.dataset(items);
    for (const key of ["kept", "new"])
      expect(
        new PodThing(`${items}#${key}`, dataset, DataFactory).types.has(`${NS.MEDIA}Track`),
      ).toBe(true);
    for (const url of [items, runs]) expect(pod.get(url)).not.toContain("https://w3id.org/jeswr/");
    const provenance = pod.dataset(runs);
    expect(
      new Provenance(`${runs}#old`, provenance, DataFactory).types.has(`${NS.CORE}Activity`),
    ).toBe(true);
    expect(
      provenance.getQuads(null, DataFactory.namedNode(`${NS.CORE}about`), null, null),
    ).toHaveLength(1);
    expect([...hostItems]).toEqual(hostBefore);
    expect([...hostRuns].some((q) => q.predicate.value.startsWith("https://w3id.org/jeswr/"))).toBe(
      true,
    );
  });

  it("reuses legacy Type Index registrations and writes canonical classes when the index changes", async () => {
    const pod = createMemoryPod();
    const indexUrl = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;
    const container = `${TEST_POD_ROOT}integrations/legacy/`;
    const legacyClass = "https://w3id.org/jeswr/sectors/media#Track";
    const profile = `${pod.get(TEST_PROFILE_DOC)}\n<${TEST_WEBID}> <${NS.SOLID}privateTypeIndex> <${indexUrl}> .`;
    expect((await pod.fetch(TEST_PROFILE_DOC, { method: "PUT", body: profile })).ok).toBe(true);
    expect(
      (
        await pod.fetch(indexUrl, {
          method: "PUT",
          body: `
      <${indexUrl}#original> a <${NS.SOLID}TypeRegistration>;
        <${NS.SOLID}forClass> <${legacyClass}>;
        <${NS.SOLID}instanceContainer> <${container}> .
      <${indexUrl}#mail> a <${NS.SOLID}TypeRegistration>;
        <${NS.SOLID}forClass> <http://schema.org/EmailMessage>;
        <${NS.SOLID}instanceContainer> <${container}mail/> .
    `,
        })
      ).ok,
    ).toBe(true);
    const options = {
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetchImpl: pod.fetch,
    };
    const fetched = await readTypeIndex(indexUrl, pod.fetch);
    expect(fetched?.locate(`${NS.MEDIA}Track`)).toHaveLength(1);
    const puts = pod.putCount;
    const first = await ensureTypeRegistrations({
      ...options,
      registrations: [{ forClass: `${NS.MEDIA}Track`, container }],
    });
    expect(first.added).toBe(0);
    expect(pod.putCount).toBe(puts);
    const second = await ensureTypeRegistrations({
      ...options,
      registrations: [
        { forClass: `${NS.MEDIA}Track`, container },
        { forClass: "https://w3id.org/jeswr/sectors/media#Playlist", container },
      ],
    });
    expect(second.added).toBe(1);
    const index = new TypeIndexDataset(pod.dataset(indexUrl), DataFactory);
    expect(index.all()).toHaveLength(3);
    expect(index.locate(`${NS.MEDIA}Track`)).toHaveLength(1);
    expect(index.locate(`${NS.MEDIA}Playlist`)).toHaveLength(1);
    expect(index.locate("http://schema.org/EmailMessage")).toHaveLength(1);
    expect(index.locate("https://schema.org/EmailMessage")).toEqual([]);
    expect(pod.get(indexUrl)).not.toContain("https://w3id.org/jeswr/");
    expect(pod.get(indexUrl)).toContain(`${indexUrl}#original`);
    expect(pod.get(indexUrl)).toContain(`${NS.MEDIA}Track`);
    expect(pod.get(indexUrl)).toContain(`${NS.MEDIA}Playlist`);
  });
});
