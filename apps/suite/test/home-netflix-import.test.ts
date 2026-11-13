// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { fileAdapterById, runFileImport } from "@jeswr/pod-connectors";
import { memoryFile } from "@jeswr/pod-connectors/testing";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { createImportWriter } from "../src/apps/home/components/connect/import-service";
import * as rdf from "../src/apps/home/lib/model/rdf";
import { readResource, subjectOf } from "../src/apps/home/lib/model/rdf";
import { domainStore, type HomeSession } from "../src/apps/home/state/use-domain-items";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("refreshes a 200-record Netflix history without serializing the shared dataset for cards", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: HomeSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice Wilder",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const adapter = fileAdapterById("netflix");
  if (!adapter) throw new Error("Netflix adapter missing");
  const csv = [
    "Title,Date",
    ...Array.from({ length: 200 }, (_, index) => `Film ${index},10/25/26`),
  ].join("\n");
  await runFileImport({
    adapter,
    file: memoryFile("NetflixViewingHistory.csv", csv, "text/csv"),
    podWriter: createImportWriter(session, "netflix", new AbortController().signal),
  });
  const serialize = vi.spyOn(rdf, "serializeTurtle");
  const store = domainStore(session);
  await store.refresh();
  const snapshot = store.getSnapshot();
  const items = snapshot.items.filter((item) => item.url.endsWith("/viewing-history.ttl"));
  expect(items).toHaveLength(200);
  expect(items.every((item) => snapshot.views.has(item))).toBe(true);
  expect(new Set(items.map((item) => item.title)).size).toBe(200);
  expect(serialize).not.toHaveBeenCalled();
});

it("imports two distinct Netflix viewings and keeps both Home cards through re-import and refresh", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const fetch = vi.fn(pod.fetch);
  const session: HomeSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice Wilder",
    storageUrl: DEMO_ROOT,
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const adapter = fileAdapterById("netflix");
  if (!adapter) throw new Error("Netflix adapter missing");
  const csv = await readFile(
    new URL("../e2e/home/fixtures/netflix-viewing-history.csv", import.meta.url),
    "utf8",
  );
  const file = memoryFile("NetflixViewingHistory.csv", csv, "text/csv");
  const run = () =>
    runFileImport({
      adapter,
      file,
      podWriter: createImportWriter(session, "netflix", new AbortController().signal),
    });
  const first = await run();
  expect(first.state?.counts.items).toBe(2);
  const url = `${DEMO_ROOT}integrations/netflix/media/viewing-history.ttl`;
  expect(first.written.map((doc) => doc.url)).toEqual([url]);
  const viewings = async () => {
    const { dataset } = await readResource(fetch, url);
    return [
      ...dataset.match(
        null,
        DataFactory.namedNode(`${NS.RDF}type`),
        DataFactory.namedNode(`${NS.SCHEMA}WatchAction`),
      ),
    ]
      .map(({ subject }) => ({
        iri: subject.value,
        title: subjectOf(dataset, subject).name,
        date: subjectOf(dataset, subject).texts(`${NS.SCHEMA}startTime`)[0],
      }))
      .sort((a, b) => a.iri.localeCompare(b.iri));
  };
  const stored = await viewings();
  expect(stored).toHaveLength(2);
  expect(new Set(stored.map((item) => item.iri)).size).toBe(2);
  expect(stored.map((item) => item.title).sort()).toEqual(["A Quiet Weekend", "The Garden"]);
  expect(stored.map((item) => item.date?.slice(0, 10)).sort()).toEqual([
    "2026-10-25",
    "2026-10-26",
  ]);

  const store = domainStore(session);
  const cards = () => store.getSnapshot().items.filter((item) => item.url === url);
  await store.refresh();
  expect(
    cards()
      .map((item) => item.title)
      .sort(),
  ).toEqual(["A Quiet Weekend", "The Garden"]);
  expect(new Set(cards().map((item) => item.subject.value)).size).toBe(2);
  const second = await run();
  expect(second.written).toEqual(first.written);
  expect(second.state?.counts.items).toBe(2);
  expect(await viewings()).toEqual(stored);
  await store.refresh();
  expect(cards()).toHaveLength(2);
  // A failed background read must retain both saved subjects in this document.
  fetch.mockImplementation((input, init) =>
    String(input) === url
      ? Promise.resolve(new Response(null, { status: 503 }))
      : pod.fetch(input, init),
  );
  await store.refresh();
  expect(
    cards()
      .map((item) => item.title)
      .sort(),
  ).toEqual(["A Quiet Weekend", "The Garden"]);
});
