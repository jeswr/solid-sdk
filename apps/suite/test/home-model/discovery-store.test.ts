// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as classification from "../../src/apps/home/lib/model/classify";
import { domainItemKey } from "../../src/apps/home/lib/model/discovery";
import { domainStore, type HomeSession } from "../../src/apps/home/state/use-domain-items";
import { type Fixture, fixtureFetch, STORAGE, WEB_ID } from "./fixtures";

beforeEach(() => vi.stubGlobal("navigator", { onLine: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const url = `${STORAGE}integrations/netflix/media/viewing-history.ttl`;

function setup(documents: Record<string, Fixture>) {
  const fixtures: Record<string, Fixture> = {
    [STORAGE]: "<> a ldp:BasicContainer.",
    [`${STORAGE}profile/card`]: "<#me> a foaf:Person; solid:privateTypeIndex <../index.ttl>.",
    [`${STORAGE}index.ttl`]: `<#netflix> a solid:TypeRegistration;
      solid:forClass schema:WatchAction; solid:instance <${url}>.`,
    ...documents,
  };
  const fetch = fixtureFetch(fixtures);
  const session: HomeSession = {
    mode: "demo",
    webId: WEB_ID,
    displayName: "Alice",
    storageUrl: STORAGE,
    fetch,
    subscribe: () => () => {},
    reset: async () => {},
  };
  return { store: domainStore(session), fixtures };
}

it("keeps one document card for blank-node records across parses and ancestor failures", async () => {
  const { store } = setup({
    [url]: `[] a schema:WatchAction; schema:name "The Garden"; prov:wasGeneratedBy <../runs.ttl#run>.
      [] a schema:WatchAction; schema:name "A Quiet Weekend"; prov:wasGeneratedBy <../runs.ttl#run>.`,
    [`${STORAGE}integrations/`]: 503,
  });
  await store.refresh();
  const first = store.getSnapshot().items.filter((item) => item.url === url);
  expect(first).toHaveLength(1);
  expect(first[0]?.subject.termType).toBe("BlankNode");
  const keys = first.map(domainItemKey);
  for (let refresh = 0; refresh < 3; refresh++) {
    await store.refresh();
    const snapshot = store.getSnapshot();
    const cards = snapshot.items.filter((item) => item.url === url);
    expect(snapshot.failures.map((failure) => failure.url)).toEqual([`${STORAGE}integrations/`]);
    expect(cards).toHaveLength(1);
    expect(cards.map(domainItemKey)).toEqual(keys);
    expect(cards[0]?.subject.value).not.toBe(first[0]?.subject.value);
  }
});

// A record removed from its document used to come back whenever an ancestor listing failed.
it("drops a removed record after its document is reread, despite an ancestor failure", async () => {
  const both = `<#garden> a schema:WatchAction; schema:name "The Garden"; prov:wasGeneratedBy <../runs.ttl#run>.
    <#weekend> a schema:WatchAction; schema:name "A Quiet Weekend"; prov:wasGeneratedBy <../runs.ttl#run>.`;
  const { store, fixtures } = setup({ [url]: both });
  await store.refresh();
  const titles = () =>
    store
      .getSnapshot()
      .items.filter((item) => item.url === url)
      .map((item) => item.title)
      .sort();
  expect(titles()).toEqual(["A Quiet Weekend", "The Garden"]);
  fixtures[url] =
    '<#garden> a schema:WatchAction; schema:name "The Garden"; prov:wasGeneratedBy <../runs.ttl#run>.';
  fixtures[`${STORAGE}integrations/`] = 503;
  await store.refresh();
  expect(titles()).toEqual(["The Garden"]);
});

it("caps a 5,000-record history before preparing views, with its own non-retry signal", async () => {
  const { store } = setup({
    [url]: Array.from(
      { length: 5_000 },
      (_, index) =>
        `<#viewing-${index}> a schema:WatchAction; schema:name "Film ${index}";
          schema:startTime "2026-10-25T00:00:00Z"; prov:wasGeneratedBy <../runs.ttl#run>.`,
    ).join("\n"),
  });
  const classify = vi.spyOn(classification, "classifySubject");
  await store.refresh();
  const snapshot = store.getSnapshot();
  const cards = snapshot.items.filter((item) => item.url === url);
  expect(cards).toHaveLength(200);
  // Record caps are not an incomplete scan: no Retry notice, no blanket preservation.
  expect(snapshot.truncated).toBe(false);
  expect(snapshot.limited.get(url)).toEqual({ shown: 200, total: 5_000 });
  expect(cards.every((item) => snapshot.views.has(item))).toBe(true);
  expect(snapshot.views.size).toBe(snapshot.items.length);
  // The document is classified once even when several domains discover its registration.
  expect(
    classify.mock.calls.filter(([subject]) => subject.value.startsWith(`${url}#viewing-`)),
  ).toHaveLength(5_000);
}, 15_000);

it("shares the 1,000-record refresh cap across domain scans, in document order, and prepares only those views", async () => {
  const types = [
    "Movie",
    "TextDigitalDocument",
    "Book",
    "TextDigitalDocument",
    "WatchAction",
    "TextDigitalDocument",
  ];
  const documents = Object.fromEntries(
    types.map((type, index) => [
      `${STORAGE}history-${index}.ttl`,
      Array.from(
        { length: 201 },
        (_, record) =>
          `<#record-${record}> a schema:${type}; schema:name "Item ${record}"; prov:wasGeneratedBy <runs.ttl#run>.`,
      ).join("\n"),
    ]),
  );
  const { store, fixtures } = setup({
    ...documents,
    [`${STORAGE}index.ttl`]: types
      .map(
        (type, index) =>
          `<#registration-${index}> a solid:TypeRegistration; solid:forClass <${NS.SCHEMA}${type}>;
        solid:instance <${STORAGE}history-${index}.ttl>.`,
      )
      .join("\n"),
  });
  await store.refresh();
  const snapshot = store.getSnapshot();
  expect(snapshot.failures).toEqual([]);
  expect(snapshot.items).toHaveLength(1_000);
  expect(snapshot.truncated).toBe(false);
  expect(snapshot.limited.size).toBeGreaterThan(0);
  expect(snapshot.views.size).toBe(1_000);
  expect(snapshot.counts.get("media")).toBeGreaterThan(0);
  expect(snapshot.counts.get("documents")).toBeGreaterThan(0);
  // Retained cards from a failed document must fit within the same refresh cap.
  fixtures[`${STORAGE}history-0.ttl`] = 503;
  await store.refresh();
  expect(store.getSnapshot().items).toHaveLength(1_000);
  expect(store.getSnapshot().views.size).toBe(1_000);
});

it("keeps every card of a small document when large imports exceed the shared budget", async () => {
  const records = (type: string, count: number, prefix: string, extra = "") =>
    Array.from(
      { length: count },
      (_, record) =>
        `<#${prefix}-${record}> a schema:${type}; schema:name "${prefix} ${record}"; ${extra} prov:wasGeneratedBy <runs.ttl#run>.`,
    ).join("\n");
  const big = Array.from({ length: 5 }, (_, index) => `${STORAGE}big-${index}.ttl`);
  const small = `${STORAGE}small.ttl`;
  const { store, fixtures } = setup({
    ...Object.fromEntries(big.map((u, index) => [u, records("Movie", 201, `big${index}`)])),
    [small]: records("Book", 3, "small"),
    [`${STORAGE}index.ttl`]: [
      ...big.map(
        (u, index) =>
          `<#b${index}> a solid:TypeRegistration; solid:forClass <${NS.SCHEMA}Movie>; solid:instance <${u}>.`,
      ),
      `<#s> a solid:TypeRegistration; solid:forClass <${NS.SCHEMA}Book>; solid:instance <${small}>.`,
    ].join("\n"),
  });
  const seen = (urls: string[]) =>
    store
      .getSnapshot()
      .items.filter((item) => urls.includes(item.url))
      .map(domainItemKey)
      .sort();
  await store.refresh();
  const first = store.getSnapshot();
  expect(first.items.length).toBeLessThanOrEqual(1_000);
  expect(seen([small])).toHaveLength(3);
  expect(first.truncated).toBe(false);
  const shown = first.items.map(domainItemKey).sort();
  // Same pod, same cards, however the responses interleave; a changed big document
  // never makes the small one (or any earlier card) vanish.
  for (let refresh = 0; refresh < 3; refresh++) {
    if (refresh === 2) fixtures[big[0] as string] = records("Movie", 201, "big0");
    await store.refresh();
    expect(store.getSnapshot().items.map(domainItemKey).sort()).toEqual(shown);
  }
  // A document that fails later keeps what it showed, within the same refresh cap.
  fixtures[big[4] as string] = 503;
  await store.refresh();
  expect(seen(big.slice(4)).length).toBeGreaterThan(0);
  expect(store.getSnapshot().items.length).toBeLessThanOrEqual(1_000);
  expect(seen([small])).toHaveLength(3);
});

it("keeps the newest 200 records of a large document and keeps preservation to that document", async () => {
  const { store, fixtures } = setup({
    [url]: Array.from(
      { length: 250 },
      (_, index) =>
        `<#viewing-${index}> a schema:WatchAction; schema:name "Film ${index}";
          dct:modified "2026-01-01T0${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}:00Z";
          schema:startTime "2026-10-25T00:00:00Z"; prov:wasGeneratedBy <../runs.ttl#run>.`,
    ).join("\n"),
  });
  await store.refresh();
  expect(store.getSnapshot().limited.get(url)).toEqual({ shown: 200, total: 250 });
  const first = store.getSnapshot().items.filter((item) => item.url === url);
  expect(first).toHaveLength(200);
  // Film 249 is the newest, so the 50 oldest are the ones left out, in any dataset order.
  expect(first.every((item) => Number(item.title.replace("Film ", "")) >= 50)).toBe(true);
  // Not an incomplete scan: a card whose registration disappears is not kept.
  fixtures[`${STORAGE}index.ttl`] = "<#none> a solid:TypeRegistration.";
  await store.refresh();
  expect(store.getSnapshot().truncated).toBe(false);
  expect(store.getSnapshot().items.filter((item) => item.url === url)).toHaveLength(0);
});
