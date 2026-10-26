// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { writeResource } from "../pod/resource.js";
import {
  ProfileTypeIndexAnchor,
  readTypeIndex,
  TypeIndexDataset,
  TypeRegistration,
} from "../pod/type-index.js";
import { ensureTypeRegistrations } from "../pod/type-index-write.js";
import { spotifyAdapter } from "../spotify/adapter.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { IntegrationAdapter, PodWriter } from "./types.js";
import { PodThing } from "./vocab.js";

/** Seed synthetic registrations with their original stored class spelling. */
function seedRegistration(dataset: Store, url: string, forClass: string, container: string) {
  const registration = new TypeRegistration(url, dataset, DataFactory);
  registration.markRegistration();
  SetFrom.subjectPredicate(
    registration,
    `${NS.SOLID}forClass`,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add(forClass);
  registration.instanceContainer = container;
}

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

  it("preserves other apps' legacy registrations and reuses connector registrations when adding canonical classes", async () => {
    const pod = createMemoryPod();
    const indexUrl = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;
    const container = `${TEST_POD_ROOT}integrations/legacy/`;
    const legacyClass = "https://w3id.org/jeswr/sectors/media#Track";
    const bookmarkClass = "https://w3id.org/jeswr/bookmark#Bookmark";
    const profile = pod.dataset(TEST_PROFILE_DOC);
    new ProfileTypeIndexAnchor(TEST_WEBID, profile, DataFactory).privateIndex = indexUrl;
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    const storedIndex = new Store();
    seedRegistration(storedIndex, `${indexUrl}#original`, legacyClass, container);
    seedRegistration(
      storedIndex,
      `${indexUrl}#mail`,
      "http://schema.org/EmailMessage",
      `${container}mail/`,
    );
    seedRegistration(
      storedIndex,
      `${indexUrl}#bookmark`,
      bookmarkClass,
      `${TEST_POD_ROOT}bookmarks/`,
    );
    await writeResource(indexUrl, storedIndex, { fetchImpl: pod.fetch });
    const originalQuads = [...pod.dataset(indexUrl)];
    const options = {
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetchImpl: pod.fetch,
    };
    const fetched = await readTypeIndex(indexUrl, pod.fetch);
    expect(fetched?.locate(`${NS.MEDIA}Track`)).toHaveLength(1);
    expect(originalQuads.every((quad) => fetched?.has(quad))).toBe(true);
    const puts = pod.putCount;
    const originalBody = pod.get(indexUrl);
    const first = await ensureTypeRegistrations({
      ...options,
      registrations: [{ forClass: `${NS.MEDIA}Track`, container }],
    });
    expect(first.added).toBe(0);
    expect(pod.putCount).toBe(puts);
    expect(pod.get(indexUrl)).toBe(originalBody);
    const second = await ensureTypeRegistrations({
      ...options,
      registrations: [
        { forClass: `${NS.MEDIA}Track`, container },
        { forClass: "https://w3id.org/jeswr/sectors/media#Playlist", container },
        { forClass: "https://schema.org/Event", container },
      ],
    });
    expect(second.added).toBe(2);
    const rewritten = pod.dataset(indexUrl);
    expect(originalQuads.every((quad) => rewritten.has(quad))).toBe(true);
    const index = new TypeIndexDataset(rewritten, DataFactory);
    expect(index.all()).toHaveLength(5);
    expect(index.locate(`${NS.MEDIA}Track`)).toHaveLength(1);
    expect(index.locate(`${NS.MEDIA}Playlist`)).toHaveLength(1);
    expect(index.locate("http://schema.org/EmailMessage")).toHaveLength(1);
    expect(index.locate("https://schema.org/EmailMessage")).toEqual([]);
    expect(index.locate(bookmarkClass)).toHaveLength(1);
    expect(index.locate("https://schema.org/Event")).toHaveLength(1);
    expect(pod.get(indexUrl)).toContain(`<${legacyClass}>`);
    expect(pod.get(indexUrl)).toContain(`<${bookmarkClass}>`);
    expect(pod.get(indexUrl)).not.toContain(`${NS.MEDIA}Track`);
    expect(pod.get(indexUrl)).not.toContain("https://w3id.org/jeswr/sectors/media#Playlist");
    expect(pod.get(indexUrl)).toContain(`${NS.MEDIA}Playlist`);
  });

  it("preserves unrelated legacy profile terms when bootstrapping a Type Index", async () => {
    const pod = createMemoryPod();
    const profile = pod.dataset(TEST_PROFILE_DOC);
    const person = new PodThing(TEST_WEBID, profile, DataFactory);
    person.types.add("https://w3id.org/jeswr/core#Agent");
    SetFrom.subjectPredicate(
      person,
      "https://w3id.org/jeswr/core#about",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add("https://source.test/synthetic-profile");
    await writeResource(TEST_PROFILE_DOC, profile, { fetchImpl: pod.fetch });
    const before = [...pod.dataset(TEST_PROFILE_DOC)];
    const result = await ensureTypeRegistrations({
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetchImpl: pod.fetch,
      registrations: [
        { forClass: `${NS.MEDIA}Track`, container: `${TEST_POD_ROOT}integrations/legacy/` },
      ],
    });
    expect(result).toMatchObject({ bootstrapped: true, added: 1 });
    const after = pod.dataset(TEST_PROFILE_DOC);
    expect(before.every((quad) => after.has(quad))).toBe(true);
    expect(after.size).toBe(before.length + 1);
    expect(new ProfileTypeIndexAnchor(TEST_WEBID, after, DataFactory).privateIndex).toBe(
      result.indexUrl,
    );
    expect(new PodThing(TEST_WEBID, after, DataFactory).types.has(`${NS.CORE}Agent`)).toBe(false);
    expect(pod.get(result.indexUrl)).toContain(`${NS.MEDIA}Track`);
  });
});
