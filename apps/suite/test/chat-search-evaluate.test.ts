// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  evaluateQuery,
  MAX_MESSAGES,
  parseQuery,
  SearchError,
  type SearchErrorCode,
  type SearchMessage,
  type SearchResult,
  searchMessages,
} from "../src/apps/chat/lib/search";
import { compareResults } from "../src/apps/chat/lib/search/evaluate";

const message: SearchMessage = Object.freeze({
  id: "https://example.org/chat/one#message",
  roomId: "https://example.org/chat/garden/",
  authorName: "Míra Vale",
  authorWebId: "https://example.org/people/mira#me",
  text: "Café gardeners meet by the blue gate. @noel https://example.org/plan",
  createdAt: Date.parse("2026-04-03T12:00:00Z"),
  hasAttachment: true,
  inReplyTo: "https://example.org/chat/one#parent",
});

function fails(action: () => unknown, code: SearchErrorCode): void {
  expect(action).toThrow(SearchError);
  expect(action).toThrow(expect.objectContaining({ code, name: "SearchError" }));
}

function matches(query: string, changes: Partial<SearchMessage> = {}, zone = "UTC"): boolean {
  return searchMessages(query, [{ ...message, ...changes }], zone).length === 1;
}

describe("message term matching", () => {
  it("folds case, decomposed accents and compatibility ligatures on word prefixes", () => {
    expect(matches("cafe GARD")).toBe(true);
    expect(matches("café", { text: "CAFE\u0301" })).toBe(true);
    expect(matches("ffi", { text: "ﬃle" })).toBe(true);
    expect(matches("cafe", { text: "decafé" })).toBe(false);
    expect(matches("arden")).toBe(false);
    expect(matches("gardens")).toBe(false);
    expect(matches("cafe", { text: "_café" })).toBe(false);
    expect(matches("cafe", { text: "123café" })).toBe(false);
    expect(matches("cafe", { text: "𐐀café" })).toBe(false);
    expect(matches("ΟΣ", { text: "οσα" })).toBe(true);
    expect(matches("ΟΣ", { text: "ος" })).toBe(true);
    expect(matches("mira")).toBe(false); // Bare terms search message text only.
  });

  it("requires contiguous whole phrases and combines all terms with exclusions", () => {
    expect(matches('"BLUE GATE" cafe -rain')).toBe(true);
    expect(matches('"blue gat"')).toBe(false);
    expect(matches('"blue gate"', { text: "blue gates" })).toBe(false);
    expect(matches('"blue gate"', { text: "blue big gate" })).toBe(false);
    expect(matches('"blue gate"', { text: "blue  gate" })).toBe(false);
    expect(matches('"blue gate"', { text: "darkblue gate" })).toBe(false);
    expect(matches('"blue gate"', { text: "(BLUE GATE)!" })).toBe(true);
    expect(matches('"🌿"', { text: "🌿seedling" })).toBe(true);
    expect(matches("cafe rain")).toBe(false);
    expect(matches("cafe -garden")).toBe(false);
    expect(matches('cafe -"blue gate"')).toBe(false);
    expect(matches('cafe -"closed gate"')).toBe(true);
    expect(matches("cafe -has:attachment")).toBe(false);
    expect(matches("cafe -has:attachment", { hasAttachment: false })).toBe(true);
    expect(matches("topic:garden", { text: "Topic:gardeners" })).toBe(true);
    expect(matches("topic:garden", { text: "gardeners" })).toBe(false);
    expect(matches("cafe", { text: "" })).toBe(false);
  });

  it("matches name prefixes, exact WebIDs, and exact room IDs", () => {
    expect(matches('from:"mira va"')).toBe(true);
    expect(matches("from:vale")).toBe(true);
    expect(matches("from:ira")).toBe(false);
    expect(matches("from:https://example.org/people/mira#me")).toBe(true);
    expect(matches("from:https://example.org/people/Mira#me")).toBe(false);
    expect(matches("from:https://example.org/people/mira")).toBe(false);
    expect(matches("in:https://example.org/chat/garden/")).toBe(true);
    expect(matches("in:garden")).toBe(false);
    expect(matches("in:https://example.org/chat/Garden/")).toBe(false);
    expect(matches("has:attachment", { text: "", authorName: "" })).toBe(true);
    expect(matches("is:thread")).toBe(true);
    expect(matches("is:thread", { inReplyTo: null })).toBe(false);
  });

  it.each([
    ["https://example.org/plan", true],
    ["(HTTP://example.org/plan).", true],
    ["first https:// second https://example.org/plan", true],
    ["https://", false],
    ["https://[invalid", false],
    ["xhttps://example.org/plan", false],
    ["https://mira:password@example.org/plan", false],
    ["ftp://example.org/plan", false],
    ["example.org/plan", false],
    ["", false],
  ])("detects HTTP(S) links in %s", (text, expected) => {
    expect(matches("has:link", { text })).toBe(expected);
  });

  it.each([
    ["Hello @noel.fen", true],
    ["(@mira-vale)", true],
    ["@Élodie", true],
    ["@[Mira Vale](https://example.org/mira#me)", true],
    ["@[https://example.org/@mira](HTTPS://example.org/noel#me)", true],
    ["@[Mira](https://example.org/`mira)", true],
    ["@[@[Mira](https://example.org/mira#me)", true],
    ["@[Mira Vale](https://[invalid)", false],
    ["@[Mira](https://example.org", false],
    ["@[Mira](https://example.org/with space)", false],
    ["@[Mira](https://mira:password@example.org)", false],
    ["@[Mira](https://example.org/\\path)", false],
    ["@[Mira\nVale](https://example.org/mira#me)", false],
    ["@[](https://example.org/mira#me)", false],
    ["mira@[Noel](https://example.org/noel#me)", false],
    ["mira@example.org", false],
    ["mira\u0301@example.org", false],
    ["@@noel", false],
    ["https://example.org/@noel", false],
    ["https://example.org/a-@noel", false],
    ["mira@example.org @noel", true],
    ["mira@example.org,@noel", true],
    ["<mira@example.org>,(@noel)", true],
    ["(mira@example.org),(@noel)", true],
    ['"mira@example.org",(@noel)', true],
    ["<mira@example.org>,(@[Noel Fen](https://example.org/noel#me))", true],
    ["<https://example.org/@mira>,(@noel)", true],
    ["<https://mira@example.org/@kit>,(@noel)", true],
    ['"https://example.org/@mira",(@noel)', true],
    ["mira@example.org@noel", false],
    ["mira+kit@example.org", false],
    ["https://mira@example.org/@noel", false],
    ["ftp://example.org/@noel", false],
    ["@[broken],(@noel)", true],
    ["@[broken\n(@noel)", true],
    ["https://example.org/@noel\n@kit", true],
    ["@", false],
    ["@[]()", false],
    ["", false],
  ])("detects mentions in %s", (text, expected) => {
    expect(matches("has:mention", { text })).toBe(expected);
    expect(matches("from:mira -has:mention", { text })).toBe(!expected);
  });

  it("scans repeated failed mention labels without rescanning their suffixes", () => {
    const labels = "@[".repeat(50_000);
    const started = performance.now();
    for (const suffix of ["", "\n", "]", "](ftp://example.org)", "](https://[invalid)"]) {
      expect(matches("has:mention", { text: labels + suffix })).toBe(false);
    }
    expect(matches("has:mention", { text: "@[a](https://<".repeat(50_000) })).toBe(false);
    expect(matches("has:mention", { text: "a".repeat(500_000) })).toBe(false);
    expect(matches("has:mention", { text: `${labels}](https://example.org/noel)` })).toBe(true);
    // A generous ceiling separates linear scans from repeated scans of 100,000 units.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe("local calendar date filters", () => {
  it("uses exclusive local dates and includes an entire day for on", () => {
    for (const createdAt of [
      "2026-04-03T00:00:00Z",
      "2026-04-03T12:00:00Z",
      "2026-04-03T23:59:59.999Z",
    ]) {
      expect(matches("on:2026-04-03", { createdAt: Date.parse(createdAt) })).toBe(true);
      expect(matches("before:2026-04-03", { createdAt: Date.parse(createdAt) })).toBe(false);
      expect(matches("after:2026-04-03", { createdAt: Date.parse(createdAt) })).toBe(false);
    }
    expect(
      matches("before:2026-04-03", { createdAt: Date.parse("2026-04-02T23:59:59.999Z") }),
    ).toBe(true);
    expect(matches("after:2026-04-03", { createdAt: Date.parse("2026-04-04T00:00:00Z") })).toBe(
      true,
    );
    expect(matches("after:2026-04-02 before:2026-04-04 on:2026-04-03")).toBe(true);
    expect(matches("on:2026-04-02")).toBe(false);
  });

  it.each([
    [
      "America/New_York",
      "2026-03-08",
      "2026-03-08T05:00:00Z",
      "2026-03-09T03:59:59.999Z",
      "2026-03-09T04:00:00Z",
    ],
    [
      "America/New_York",
      "2026-11-01",
      "2026-11-01T04:00:00Z",
      "2026-11-02T04:59:59.999Z",
      "2026-11-02T05:00:00Z",
    ],
    [
      "Asia/Kathmandu",
      "2026-04-03",
      "2026-04-02T18:15:00Z",
      "2026-04-03T18:14:59.999Z",
      "2026-04-03T18:15:00Z",
    ],
    [
      "Pacific/Kiritimati",
      "2026-04-03",
      "2026-04-02T10:00:00Z",
      "2026-04-03T09:59:59.999Z",
      "2026-04-03T10:00:00Z",
    ],
  ])("covers complete local days in %s", (zone, day, start, end, next) => {
    expect(matches(`on:${day}`, { createdAt: Date.parse(start) }, zone)).toBe(true);
    expect(matches(`on:${day}`, { createdAt: Date.parse(end) }, zone)).toBe(true);
    expect(matches(`on:${day}`, { createdAt: Date.parse(start) - 1 }, zone)).toBe(false);
    expect(matches(`before:${day}`, { createdAt: Date.parse(start) - 1 }, zone)).toBe(true);
    expect(matches(`on:${day}`, { createdAt: Date.parse(next) }, zone)).toBe(false);
    expect(matches(`after:${day}`, { createdAt: Date.parse(next) }, zone)).toBe(true);
  });

  it("handles skipped dates, the repeated DST hour, and timestamp extrema", () => {
    expect(
      matches("on:2011-12-30", { createdAt: Date.parse("2011-12-30T12:00:00Z") }, "Pacific/Apia"),
    ).toBe(false);
    for (const instant of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
      expect(matches("on:2026-11-01", { createdAt: Date.parse(instant) }, "America/New_York")).toBe(
        true,
      );
    }
    expect(
      matches("before:0001-01-01", { createdAt: -62_135_596_800_000 }, "America/New_York"),
    ).toBe(true);
    expect(
      matches("after:9999-12-31", { createdAt: 253_402_300_799_999 }, "Pacific/Kiritimati"),
    ).toBe(true);
    expect(matches("on:0001-01-01", { createdAt: -62_135_596_800_000 })).toBe(true);
    expect(matches("on:9999-12-31", { createdAt: 253_402_300_799_999 })).toBe(true);
  });
});

describe("ranking and snapshot validation", () => {
  it("sorts newest first and breaks ties by ID without changing records or input order", () => {
    const messages = Object.freeze([
      Object.freeze({ ...message, id: "z", createdAt: 1 }),
      Object.freeze({ ...message, id: "b", createdAt: 2 }),
      Object.freeze({ ...message, id: "a", createdAt: 2 }),
    ]);
    const results = evaluateQuery(parseQuery("cafe gard -rain has:link"), messages, "UTC");
    expect(results.map((result) => [result.message.id, result.score])).toEqual([
      ["a", 3],
      ["b", 3],
      ["z", 3],
    ]);
    expect(results[0]?.message).toBe(messages[2]);
    expect(messages.map((item) => item.id)).toEqual(["z", "b", "a"]);
    expect(searchMessages("missing", messages, "UTC")).toEqual([]);
    expect(searchMessages("cafe", [], "UTC")).toEqual([]);
  });

  it("orders score before recency and then IDs", () => {
    const result = (id: string, score: number, createdAt: number): SearchResult => ({
      message: { ...message, id, createdAt },
      score,
      snippet: { text: "", ranges: [] },
    });
    const results = [result("z", 2, 1), result("b", 1, 3), result("c", 2, 2), result("a", 2, 2)];
    expect(compareResults(result("c", 2, 2), result("a", 2, 2))).toBeGreaterThan(0);
    expect(compareResults(results[0] as SearchResult, results[0] as SearchResult)).toBe(0);
    expect(results.sort(compareResults).map((item) => item.message.id)).toEqual([
      "a",
      "c",
      "z",
      "b",
    ]);
  });

  it("accepts the message limit and rejects bound + 1 before accessing elements or parsing", () => {
    const messages = Array.from({ length: MAX_MESSAGES }, (_, index) => ({
      ...message,
      id: `message-${index}`,
      hasAttachment: false,
    }));
    expect(searchMessages("has:attachment", messages, "UTC")).toEqual([]);
    expect(
      searchMessages("-has:attachment in:https://example.org/chat/garden/", messages, "UTC"),
    ).toHaveLength(MAX_MESSAGES);
    const tooMany = new Array<SearchMessage>(MAX_MESSAGES + 1);
    Object.defineProperty(tooMany, 0, {
      get() {
        throw new Error("elements must not be read");
      },
    });
    fails(() => searchMessages('"', tooMany, "bad-zone"), "TOO_MANY_MESSAGES");
    fails(() => evaluateQuery(null as never, tooMany, "bad-zone"), "TOO_MANY_MESSAGES");
  });

  it.each([
    null,
    {},
    [null],
    new Array(1),
    [message, message],
  ])("rejects malformed snapshots and duplicate IDs", (messages) => {
    fails(() => searchMessages("missing", messages as SearchMessage[], "UTC"), "INVALID_MESSAGE");
  });

  it.each([
    { id: "" },
    { id: 1 },
    { roomId: " " },
    { authorName: null },
    { authorName: "\ud800" },
    { authorWebId: "" },
    { text: 3 },
    { text: "\udfff" },
    { createdAt: NaN },
    { createdAt: Infinity },
    { createdAt: 1.5 },
    { createdAt: -62_135_596_800_001 },
    { createdAt: 253_402_300_800_000 },
    { createdAt: "2026-04-03" },
    { createdAt: new Date(0) },
    { hasAttachment: 1 },
    { inReplyTo: undefined },
    { inReplyTo: "" },
  ])("validates every record even when it would be filtered out", (change) => {
    fails(
      () =>
        searchMessages(
          "missing",
          [message, { ...message, id: "other", ...change } as SearchMessage],
          "UTC",
        ),
      "INVALID_MESSAGE",
    );
  });

  it.each([
    null,
    "",
    "UTC ",
    "+05:45",
    "Not/AZone",
  ])("rejects invalid zones, even with no dates or messages", (zone) => {
    fails(() => searchMessages("cafe", [], zone as string), "INVALID_TIME_ZONE");
  });
  it("handles messages with many occurrences without an argument-count overflow", () => {
    const text = "a ".repeat(150_000);
    const results = searchMessages("a", [{ ...message, text }], "UTC");
    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBe(1);
    expect(results[0]?.snippet.text.length).toBe(160);
  });

  it("validates untrusted ASTs before filtering messages", () => {
    fails(
      () =>
        evaluateQuery(
          {
            type: "query",
            terms: [{ type: "filter", field: "on", value: "2026-02-30", negated: false }],
          },
          [],
          "UTC",
        ),
      "INVALID_DATE",
    );
  });
});
