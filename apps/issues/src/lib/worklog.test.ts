// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import { Issue, WorklogSet } from "./issue";
import { formatDuration, parseDuration } from "./dates";

const TRACKER = "http://localhost:3000/alice/issue-tracker/tracker.ttl#this";
const URL_ = "http://localhost:3000/alice/issue-tracker/issues/x.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

describe("F4 worklog — round-trip", () => {
  it("a logged entry round-trips who / duration / when / note", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Implement F4";
    issue.state = "open";
    const at = new Date("2026-06-12T09:00:00.000Z");
    issue.logWork(`${URL_}#work-1`, { actor: ME, at, seconds: 5400, note: "Pairing session." });

    // Re-read from a FRESH wrapper over the same dataset (true round-trip).
    const reread = new Issue(`${URL_}#this`, ds, DataFactory);
    expect(reread.worklog).toHaveLength(1);
    const w = reread.worklog[0];
    expect(w.actor).toBe(ME);
    expect(w.seconds).toBe(5400);
    expect(w.at?.toISOString()).toBe(at.toISOString());
    expect(w.note).toBe("Pairing session.");
    expect(w.issue).toBe(`${URL_}#this`);
  });

  it("an entry with no note still round-trips its duration", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "No-note entry";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: BOB, at: new Date("2026-06-12T11:00:00.000Z"), seconds: 1800 });

    const w = new Issue(`${URL_}#this`, ds, DataFactory).worklog[0];
    expect(w.note).toBeUndefined();
    expect(w.seconds).toBe(1800);
  });

  it("supports fractional seconds (xsd:decimal)", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Fractional";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: ME, at: new Date(), seconds: 1234.5 });
    expect(new Issue(`${URL_}#this`, ds, DataFactory).worklog[0].seconds).toBe(1234.5);
  });

  it("loggedSeconds sums an issue's own entries", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Multi-entry";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: ME, at: new Date("2026-06-12T09:00:00Z"), seconds: 3600 });
    issue.logWork(`${URL_}#work-2`, { actor: BOB, at: new Date("2026-06-12T13:00:00Z"), seconds: 1800 });
    const reread = new Issue(`${URL_}#this`, ds, DataFactory);
    expect(reread.loggedSeconds).toBe(5400);
    expect(reread.worklog).toHaveLength(2);
  });

  it("is append-only — a second log never mutates the first entry's effort", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Append-only";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: ME, at: new Date("2026-06-12T09:00:00Z"), seconds: 3600, note: "first" });
    const firstId = new Issue(`${URL_}#this`, ds, DataFactory).worklog[0].id;
    issue.logWork(`${URL_}#work-2`, { actor: ME, at: new Date("2026-06-12T10:00:00Z"), seconds: 600, note: "second" });
    const entries = new Issue(`${URL_}#this`, ds, DataFactory).worklog;
    const first = entries.find((e) => e.id === firstId)!;
    expect(first.seconds).toBe(3600); // unchanged
    expect(first.note).toBe("first"); // unchanged
  });

  it("WorklogSet sorts newest-first with a stable tie-break", () => {
    const ds = new Store();
    const sameTime = new Date("2026-06-12T09:00:00.000Z");
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Sorting";
    issue.state = "open";
    issue.logWork(`${URL_}#work-a`, { actor: ME, at: sameTime, seconds: 60 });
    issue.logWork(`${URL_}#work-b`, { actor: ME, at: new Date("2026-06-12T12:00:00.000Z"), seconds: 60 });
    issue.logWork(`${URL_}#work-c`, { actor: ME, at: sameTime, seconds: 60 });
    const entries = new WorklogSet(ds, DataFactory).entries;
    expect(entries[0].id).toBe(`${URL_}#work-b`); // latest time first
    // The two same-time entries follow, ordered by IRI (a before c) for stability.
    expect(entries[1].id).toBe(`${URL_}#work-a`);
    expect(entries[2].id).toBe(`${URL_}#work-c`);
  });

  it("ignores non-worklog prov:Activity nodes (e.g. F3 status entries) in the same doc", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Mixed activities";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: ME, at: new Date(), seconds: 60 });
    // A non-worklog prov:Activity (a foreign F3-style "status" entry) must not be counted.
    const foreign = DataFactory.namedNode(`${URL_}#act-foreign`);
    ds.addQuad(foreign, DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), DataFactory.namedNode("http://www.w3.org/ns/prov#Activity"));
    ds.addQuad(foreign, DataFactory.namedNode("http://purl.org/dc/terms/type"), DataFactory.literal("status"));
    const entries = new Issue(`${URL_}#this`, ds, DataFactory).worklog;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(`${URL_}#work-1`);
  });
});

describe("F4 duration formatting / parsing", () => {
  it("formats hours and minutes compactly", () => {
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(1800)).toBe("30m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("parses h/m strings, bare minutes, and fractional hours", () => {
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("1h30m")).toBe(5400); // no separating space
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("45")).toBe(2700); // bare number = minutes
    expect(parseDuration("2h")).toBe(7200);
  });

  it("returns undefined for empty / non-numeric / zero input", () => {
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("   ")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("0m")).toBeUndefined();
  });

  it("rejects partial / garbage input strictly (reject, not silent partial parse)", () => {
    // The whole string must match the grammar — a leftover unitless token rejects it
    // rather than logging only the parsed prefix (was silently 1h before).
    expect(parseDuration("1h 30")).toBeUndefined();
    // Number(), not parseFloat: trailing garbage after a bare number rejects (was 45m).
    expect(parseDuration("45abc")).toBeUndefined();
    // Leading / trailing / embedded garbage all reject.
    expect(parseDuration("abc1h")).toBeUndefined();
    expect(parseDuration("1h xyz")).toBeUndefined();
    expect(parseDuration("1h 30m foo")).toBeUndefined();
    // A bare unit with no magnitude, or an unsupported unit, rejects.
    expect(parseDuration("h")).toBeUndefined();
    expect(parseDuration("m")).toBeUndefined();
    expect(parseDuration("1d")).toBeUndefined();
    expect(parseDuration("1x")).toBeUndefined();
  });

  it("accepts valid multi-term / fractional forms exactly", () => {
    expect(parseDuration("1h30m")).toBe(5400);
    expect(parseDuration("90m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
  });

  it("format/parse round-trips at minute granularity", () => {
    expect(parseDuration(formatDuration(5400))).toBe(5400);
    expect(parseDuration(formatDuration(3660))).toBe(3660); // 1h 1m
  });

  it("formatDuration floors sub-minute remainders (never rounds up logged time)", () => {
    // 89s is 1m29s → "1m", NOT "1m" via round (90s would round to 2m).
    expect(formatDuration(89)).toBe("1m");
    expect(formatDuration(59)).toBe("0m"); // under a minute is dropped, not rounded up
    expect(formatDuration(119)).toBe("1m"); // 1m59s → 1m
  });
});

describe("F4 worklog — unit enforcement on read", () => {
  const TIME = "http://www.w3.org/2006/time#";
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";

  it("skips (reads 0) a duration whose unit is not time:unitSecond", () => {
    // A foreign worklog whose duration is in minutes (not seconds): the magnitude 90
    // must NOT be summed as 90 seconds. The reader requires time:unitSecond.
    const ds = new Store();
    const work = DataFactory.namedNode(`${URL_}#work-min`);
    const dur = DataFactory.namedNode(`${URL_}#work-min-dur`);
    ds.addQuad(work, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode("http://www.w3.org/ns/prov#Activity"));
    ds.addQuad(work, DataFactory.namedNode("http://purl.org/dc/terms/type"), DataFactory.literal("worklog"));
    ds.addQuad(work, DataFactory.namedNode("http://www.w3.org/ns/prov#used"), DataFactory.namedNode(`${URL_}#this`));
    ds.addQuad(work, DataFactory.namedNode("http://www.w3.org/ns/prov#startedAtTime"), DataFactory.literal(new Date("2026-06-12T09:00:00Z").toISOString(), DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime")));
    ds.addQuad(work, DataFactory.namedNode(`${TIME}hasDuration`), dur);
    ds.addQuad(dur, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${TIME}Duration`));
    ds.addQuad(dur, DataFactory.namedNode(`${TIME}numericDuration`), DataFactory.literal("90", DataFactory.namedNode(XSD_DECIMAL)));
    ds.addQuad(dur, DataFactory.namedNode(`${TIME}unitType`), DataFactory.namedNode(`${TIME}unitMinute`)); // NOT unitSecond

    const w = new WorklogSet(ds, DataFactory).entries[0];
    expect(w.seconds).toBe(0); // skipped, not mis-summed as 90s
  });

  it("skips a duration with no unitType at all", () => {
    const ds = new Store();
    const work = DataFactory.namedNode(`${URL_}#work-nounit`);
    const dur = DataFactory.namedNode(`${URL_}#work-nounit-dur`);
    ds.addQuad(work, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode("http://www.w3.org/ns/prov#Activity"));
    ds.addQuad(work, DataFactory.namedNode("http://purl.org/dc/terms/type"), DataFactory.literal("worklog"));
    ds.addQuad(work, DataFactory.namedNode(`${TIME}hasDuration`), dur);
    ds.addQuad(dur, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${TIME}Duration`));
    ds.addQuad(dur, DataFactory.namedNode(`${TIME}numericDuration`), DataFactory.literal("3600", DataFactory.namedNode(XSD_DECIMAL)));
    // no time:unitType

    const w = new WorklogSet(ds, DataFactory).entries[0];
    expect(w.seconds).toBe(0);
  });

  it("still reads a proper time:unitSecond duration", () => {
    const ds = new Store();
    const issue = new Issue(`${URL_}#this`, ds, DataFactory);
    issue.tracker = TRACKER;
    issue.title = "Seconds duration";
    issue.state = "open";
    issue.logWork(`${URL_}#work-1`, { actor: ME, at: new Date("2026-06-12T09:00:00Z"), seconds: 5400 });
    expect(new WorklogSet(ds, DataFactory).entries[0].seconds).toBe(5400);
  });
});
