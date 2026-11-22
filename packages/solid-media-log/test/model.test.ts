// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { entities, nodes } from "../src/generated/model.js";
import {
  buildMediaLog,
  isMediaDate,
  type MediaEntry,
  mediaUrl,
  parseMediaLog,
  STATUSES,
  serializeMediaLog,
  validateEntry,
  WORK_TYPES,
} from "../src/model.js";

const url = "https://pod.example/media/log";
const base: MediaEntry = { title: "A fictional work", kind: "film", status: "want" };
describe("generated media log", () => {
  for (const kind of Object.keys(WORK_TYPES) as MediaEntry["kind"][])
    for (const status of STATUSES)
      it(`round-trips ${kind} / ${status}`, async () => {
        const data: MediaEntry = {
          ...base,
          kind,
          status,
          year: 2025,
          creator: "Aster Vale",
          cover: "https://example.org/cover.png",
          started: "2026-01-02",
          finished: status === "finished" ? "2026-02-04" : undefined,
          rating: 4.5,
          review: 'A "memorable" story.\nSecond line.',
          progress: 12,
          progressUnit: "episode",
          repeatCount: 2,
          source: "Manual",
          origin: "https://example.org/work",
        };
        const ttl = await serializeMediaLog(url, data);
        const dataset = await parseRdf(ttl, "text/turtle", { baseIRI: url });
        expect(parseMediaLog(url, dataset)).toEqual(data);
        expect(
          new nodes.MediaLog.work.Wrapper(
            nodes.MediaLog.work.subject(url),
            dataset,
            DataFactory,
          ).types.has(WORK_TYPES[kind]),
        ).toBe(true);
      });
  it("fails closed on missing required values and unsafe subjects", () => {
    expect(parseMediaLog(url, new Store())).toBeUndefined();
    expect(() => buildMediaLog("relative", base)).toThrow();
    expect(parseMediaLog("relative", buildMediaLog(url, base))).toBeUndefined();
    const store = buildMediaLog(url, base);
    new nodes.MediaLog.work.Wrapper(nodes.MediaLog.work.subject(url), store, DataFactory).title =
      undefined;
    expect(parseMediaLog(url, store)).toBeUndefined();
  });
  it("enforces facade date order and length policy on untrusted generated reads", () => {
    const invalid = entities.MediaLog.build(url, {
      title: "x".repeat(501),
      workType: WORK_TYPES.book,
      status: "want",
    });
    expect(parseMediaLog(url, invalid)).toBeUndefined();
    const dates = entities.MediaLog.build(url, {
      title: "Book",
      workType: WORK_TYPES.book,
      status: "finished",
      started: new Date("2026-03-01"),
      finished: new Date("2026-01-01"),
    });
    expect(parseMediaLog(url, dates)).toBeUndefined();
  });
  it("trims titles, keeps inert review strings and guards numeric enum writes", () => {
    expect(validateEntry({ ...base, title: "  A title  " }).title).toBe("A title");
    const store = buildMediaLog(url, base);
    const entry = new entities.MediaLog.Wrapper(entities.MediaLog.subject(url), store, DataFactory);
    const rating = new nodes.MediaLog.rating.Wrapper(
      nodes.MediaLog.rating.subject(url),
      store,
      DataFactory,
    );
    rating.rating = 3.25 as 3;
    expect(rating.rating).toBeUndefined();
    entry.status = "bogus" as "want";
    expect(parseMediaLog(url, store)).toBeUndefined();
  });
});
describe("input validation", () => {
  it.each(["2024-02-29", "2026-12-31", "1000-01-01"])("accepts calendar date %s", (date) =>
    expect(isMediaDate(date)).toBe(true));
  it.each([
    "2026-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-1-01",
    "no",
    "2026-01-01T00:00:00Z",
  ])("rejects invalid date %s", (date) => expect(isMediaDate(date)).toBe(false));
  it.each([
    "javascript:alert(1)",
    "data:text/plain,x",
    "/cover",
    "https://name:secret@example.org/a",
    "http://name@example.org/a",
    "https://example.org/a> <bad",
    "not a url",
  ])("rejects unsafe display URL %s", (value) => expect(mediaUrl(value)).toBeUndefined());
  it.each([
    "http://example.org/a",
    "https://example.org/cover.png",
  ])("accepts display URL %s", (value) => expect(mediaUrl(value)).toBe(value));
  it.each([
    { title: " " },
    { title: "x".repeat(501) },
    { kind: "__proto__" },
    { status: "reading" },
    { year: 999 },
    { year: 10000 },
    { year: 2026.5 },
    { year: NaN },
    { rating: 0 },
    { rating: 5.5 },
    { rating: 3.25 },
    { rating: NaN },
    { rating: Infinity },
    { progress: -1 },
    { progress: 0.1 },
    { progress: Infinity },
    { repeatCount: -1 },
    { repeatCount: Number.MAX_SAFE_INTEGER + 1 },
    { progressUnit: "minute" },
    { started: "bad" },
    { finished: "bad" },
    { status: "want", finished: "2026-01-01" },
    { status: "finished", started: "2026-02-01", finished: "2026-01-01" },
    { cover: "javascript:x" },
    { origin: "https://u:p@example.org" },
    { creator: "x".repeat(501) },
    { source: "x".repeat(501) },
    { review: "x".repeat(20001) },
  ])("rejects invalid field %#", (patch) =>
    expect(() => validateEntry({ ...base, ...patch } as MediaEntry)).toThrow(TypeError));
  it("accepts boundary numbers and dates, and a finished entry with an unknown date", () => {
    expect(
      validateEntry({
        ...base,
        year: 1000,
        rating: 0.5,
        repeatCount: 0,
        progress: 0,
        progressUnit: "page",
      }),
    ).toMatchObject({ rating: 0.5 });
    expect(
      validateEntry({
        ...base,
        year: 9999,
        rating: 5,
        status: "finished",
        started: "2026-01-01",
        finished: "2026-01-01",
      }),
    ).toMatchObject({ rating: 5 });
    expect(validateEntry({ ...base, status: "finished" }).finished).toBeUndefined();
  });
});

it("uses generated singleton Review and Rating children, HTTP schema terms and an IRI source", async () => {
  const dataset = buildMediaLog(url, {
    ...base,
    review: "A quiet story",
    rating: 4.5,
    source: "Letterboxd",
    origin: "https://letterboxd.com/film/quiet-story/",
  });
  const entry = new nodes.MediaLog.entry.Wrapper(
    entities.MediaLog.subject(url),
    dataset,
    DataFactory,
  );
  expect(entry.review).toBe(nodes.MediaLog.review.subject(url));
  const review = new nodes.MediaLog.review.Wrapper(entry.review as string, dataset, DataFactory);
  expect(review.reviewText).toBe("A quiet story");
  expect(review.reviewRating).toBe(nodes.MediaLog.rating.subject(url));
  const rating = new nodes.MediaLog.rating.Wrapper(
    review.reviewRating as string,
    dataset,
    DataFactory,
  );
  expect(rating.rating).toBe(4.5);
  expect(review.types.has("http://schema.org/Review")).toBe(true);
  expect(rating.types.has("http://schema.org/Rating")).toBe(true);
  const ttl = await serializeMediaLog(url, { ...base, source: "Manual" });
  expect(ttl).not.toContain("dct:source");
  expect(ttl).not.toContain("https://schema.org/");
});
it("accepts HTTPS work-kind values on read and writes HTTP kind values", () => {
  const store = entities.MediaLog.build(url, {
    title: "A book",
    status: "want",
    workType: "https://schema.org/Book",
  });
  const parsed = parseMediaLog(url, store);
  expect(parsed?.kind).toBe("book");
  if (!parsed) throw new Error("Missing parsed work");
  const rebuilt = buildMediaLog(url, parsed);
  expect(
    new nodes.MediaLog.work.Wrapper(nodes.MediaLog.work.subject(url), rebuilt, DataFactory)
      .workType,
  ).toBe("http://schema.org/Book");
});
