// AUTHORED-BY Codex (GPT-6.1 Sol)
import { Provenance } from "@jeswr/pod-connectors/core/provenance";
import { Book, VideoGame, WatchAction } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { connectorEntries, groupNetflixEntries, isConnectorDocument } from "../src/connectors.js";

it("projects the exact typed Goodreads, Netflix and Steam output without mutating it", () => {
  const store = new Store();
  const book = new Book("https://pod.example/goodreads#book", store, DataFactory).mark();
  book.name = "The Orchard Letters";
  book.author = "Aster Reed";
  book.readingStatus = "read";
  book.ratingValue = 4;
  book.sourceUrl = "https://www.goodreads.com/book/show/42";
  const watch = new WatchAction("https://pod.example/netflix#watch", store, DataFactory).mark();
  watch.name = "Harbour Days";
  watch.startTime = new Date("2026-02-03T00:00:00Z");
  const game = new VideoGame("https://pod.example/steam#game", store, DataFactory).mark();
  game.name = "Mosslight";
  game.timeRequired = "PT20M";
  new Provenance("https://pod.example/netflix#watch", store, DataFactory).derivedFrom.add(
    "urn:solid:connector:netflix:export",
  );
  new Provenance("https://pod.example/steam#game", store, DataFactory).derivedFrom.add(
    "urn:solid:connector:steam:export",
  );
  const before = [...store];
  expect(connectorEntries(store)).toEqual([
    {
      id: "https://pod.example/goodreads#book",
      data: {
        title: "The Orchard Letters",
        kind: "book",
        creator: "Aster Reed",
        status: "finished",
        rating: 4,
        source: "Goodreads",
        origin: book.sourceUrl,
      },
    },
    {
      id: "https://pod.example/netflix#watch",
      data: {
        title: "Harbour Days",
        kind: "film",
        status: "finished",
        finished: "2026-02-03",
        source: "Netflix",
        origin: "https://pod.example/netflix#watch",
      },
    },
    {
      id: "https://pod.example/steam#game",
      data: {
        title: "Mosslight",
        kind: "game",
        status: "in-progress",
        source: "Steam",
        origin: "https://pod.example/steam#game",
      },
    },
  ]);
  expect([...store]).toEqual(before);
});
it.each([
  ["currently-reading", "in-progress"],
  ["to-read", "want"],
  ["did-not-finish", "abandoned"],
  ["unknown", "want"],
])("maps Goodreads shelf %s", (shelf, status) => {
  const store = new Store();
  const book = new Book("https://pod.example/b#it", store, DataFactory).mark();
  book.name = "Book";
  book.readingStatus = shelf;
  book.ratingValue = 0;
  expect(connectorEntries(store)[0]?.data).toMatchObject({ status, rating: undefined });
});
it.each([
  undefined,
  "PT0M",
  "PT0S",
  "PT3H",
])("does not call an owned game finished (%s)", (duration) => {
  const store = new Store();
  const game = new VideoGame("https://pod.example/g#it", store, DataFactory).mark();
  game.name = "Game";
  game.timeRequired = duration;
  expect(connectorEntries(store)[0]?.data.status).toBe(
    duration === "PT3H" ? "in-progress" : "want",
  );
});
it("ignores unnamed, oversized and unsafe subjects and unrelated types", () => {
  const store = new Store();
  for (const [url, title] of [
    ["https://pod.example/a", ""],
    ["https://pod.example/b", "x".repeat(501)],
    ["https://u:p@pod.example/c", "A"],
  ])
    new Book(url as string, store, DataFactory).mark().name = title;
  const unknown = new Book("https://pod.example/unknown", store, DataFactory);
  unknown.name = "Unknown";
  expect(connectorEntries(store)).toEqual([]);
});
it("keeps unknown Netflix completion dates absent and drops invalid ratings", () => {
  const store = new Store();
  const watch = new WatchAction("https://pod.example/w", store, DataFactory).mark();
  watch.name = "Show";
  const book = new Book("https://pod.example/b", store, DataFactory).mark();
  book.name = "Book";
  book.ratingValue = 5.25;
  expect(connectorEntries(store)[0]?.data.finished).toBeUndefined();
  expect(connectorEntries(store)[1]?.data.rating).toBeUndefined();
});

it("keeps generic typed works separate from provider attribution", () => {
  const store = new Store();
  const book = new Book("https://pod.example/book", store, DataFactory).mark();
  book.name = "A book";
  const watch = new WatchAction("https://pod.example/watch", store, DataFactory).mark();
  watch.name = "A stream";
  watch.sourceUrl = "https://www.twitch.tv/example";
  const game = new VideoGame("https://pod.example/game", store, DataFactory).mark();
  game.name = "A game";
  expect(connectorEntries(store).map((entry) => entry.data.source)).toEqual([
    "Imported",
    "Imported",
  ]);
  new Provenance(book.value, store, DataFactory).derivedFrom.add(
    "urn:solid:connector:goodreads:export",
  );
  expect(connectorEntries(store)[0]?.data.source).toBe("Goodreads");
});

it("groups Netflix episodes into one in-progress series across source documents and ignores generic WatchActions", () => {
  const entries = [1, 2].flatMap((episode) => {
    const store = new Store();
    const id = `https://pod.example/netflix/history-${episode}#watch`;
    const watch = new WatchAction(id, store, DataFactory).mark();
    watch.name = `Harbour Days: Season 1: Episode ${episode}`;
    watch.startTime = new Date(`2026-02-0${episode}T00:00:00Z`);
    new Provenance(id, store, DataFactory).derivedFrom.add("urn:solid:connector:netflix:export");
    return connectorEntries(store);
  });
  expect(groupNetflixEntries(entries)).toEqual([
    {
      id: "https://pod.example/netflix/#series-harbour%20days",
      data: {
        title: "Harbour Days",
        kind: "tv",
        status: "in-progress",
        progress: 2,
        progressUnit: "episode",
        finished: undefined,
        source: "Netflix",
        origin: "https://pod.example/netflix/#series-harbour%20days",
      },
    },
  ]);
  const store = new Store();
  new WatchAction("https://pod.example/generic", store, DataFactory).mark().name =
    "Unclassified stream";
  expect(connectorEntries(store)).toEqual([]);
});
it.each([
  "Mosslight: The Return",
  "Star Wars: Episode IV – A New Hope",
  "Mission: Impossible: Fallout",
  "A Film: Parting Ways",
  "A Film: Season of Rain",
  "John Wick: Chapter 2",
  "John Wick: Chapter 3 – Parabellum",
  "Kill Bill: Volume 1",
  "Harry Potter and the Deathly Hallows: Part 2",
])("does not turn the film subtitle %s into a series", (title) => {
  const item = {
    id: "https://pod.example/netflix#film",
    data: {
      title,
      kind: "film" as const,
      status: "finished" as const,
      source: "Netflix",
    },
  };
  expect(groupNetflixEntries([item])).toEqual([item]);
});
it.each([
  "Season 1",
  "Series 2",
  "Limited Series",
  "Part 3",
  "Volume 1",
  "Book 2",
  "Chapter 3",
])("groups explicit %s episodes and counts distinct titles across documents", (marker) => {
  const entries = [1, 1, 2].flatMap((episode, i) => {
    const dataset = new Store();
    const id = `https://pod.example/netflix/history-${i}#watch`;
    const watch = new WatchAction(id, dataset, DataFactory).mark();
    watch.name = `Harbour Days: ${marker}: Chapter ${episode}`;
    new Provenance(id, dataset, DataFactory).derivedFrom.add("urn:solid:connector:netflix:export");
    return connectorEntries(dataset);
  });
  const before = structuredClone(entries);
  const grouped = groupNetflixEntries(entries);
  expect(grouped).toHaveLength(1);
  expect(grouped[0]?.data).toMatchObject({
    title: "Harbour Days",
    kind: "tv",
    status: "in-progress",
    progress: 2,
  });
  expect(entries).toEqual(before);
  expect(groupNetflixEntries(grouped)).toEqual(grouped);
});
it("recognises connector documents even when their WatchActions have no media projection", () => {
  const dataset = new Store();
  expect(isConnectorDocument(dataset)).toBe(false);
  new Book("https://pod.example/untyped", dataset, DataFactory).name = "Untyped";
  expect(isConnectorDocument(dataset)).toBe(false);
  new WatchAction("https://pod.example/takeout#watch", dataset, DataFactory).mark();
  expect(isConnectorDocument(dataset)).toBe(true);
  expect(connectorEntries(dataset)).toEqual([]);
});
it.each([
  ["Book", Book],
  ["VideoGame", VideoGame],
] as const)("does not exempt a dropped %s document, even alongside a WatchAction", (_, Wrapper) => {
  const dataset = new Store();
  new Wrapper("https://pod.example/import#item", dataset, DataFactory).mark().name = " ";
  expect(connectorEntries(dataset)).toEqual([]);
  expect(isConnectorDocument(dataset)).toBe(false);
  new WatchAction("https://pod.example/import#watch", dataset, DataFactory).mark();
  expect(connectorEntries(dataset)).toEqual([]);
  expect(isConnectorDocument(dataset)).toBe(false);
});
it("groups Love, Death & Robots volume titles as an unfinished series", () => {
  const entries = ["Sonnie's Edge", "Three Robots"].map((episode, i) => ({
    id: `https://pod.example/netflix/history-${i}#watch`,
    data: {
      title: `Love, Death & Robots: Volume 1: ${episode}`,
      kind: "film" as const,
      status: "finished" as const,
      source: "Netflix",
    },
  }));
  expect(groupNetflixEntries(entries)).toMatchObject([
    { data: { title: "Love, Death & Robots", kind: "tv", status: "in-progress", progress: 2 } },
  ]);
});
