// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { XML_SCAN_CHARGE_CHARS, xmlEvents } from "../core/mini-xml.js";
import { ActivityBudget } from "./model.js";
import { xmlActivities } from "./xml.js";

const PIECE = 16384;
/** Lazily yields a large document and records how much of it the parser pulled. */
function source(head: string, body: () => string, pieces: number, tail: string) {
  const pulled = { pieces: 0 };
  async function* chunks() {
    yield head;
    for (let i = 0; i < pieces; i++) {
      pulled.pieces++;
      yield body();
    }
    yield tail;
  }
  return { chunks: chunks(), pulled };
}
async function drain(budget: ActivityBudget, chunks: AsyncIterable<string>) {
  const activities = [];
  for await (const activity of xmlActivities(chunks, budget)) activities.push(activity);
  return activities;
}

describe("XML scan work is charged to the message budget", () => {
  it("calls onScan once per 512 characters, inside comments too", async () => {
    let charges = 0;
    const xml = `<gpx><!--${"x".repeat(3 * XML_SCAN_CHARGE_CHARS)}--></gpx>`;
    async function* one() {
      yield xml;
    }
    for await (const _ of xmlEvents(one(), { onScan: () => charges++ })) {
      // drain
    }
    expect(charges).toBe(Math.floor(Array.from(xml).length / XML_SCAN_CHARGE_CHARS));
  });
  it("stops a 16 MiB comment bomb early at the message cap", async () => {
    const budget = new ActivityBudget({ messages: 1000 });
    const { chunks, pulled } = source("<gpx><!--", () => "x".repeat(PIECE), 1024, "--></gpx>");
    expect(await drain(budget, chunks)).toEqual([]);
    expect(budget.warnings).toContain("message-cap-exceeded");
    // 1,000 messages cover at most 1,000 * 512 characters: 32 of the 1,024 pieces.
    expect(pulled.pieces).toBeLessThanOrEqual(
      Math.ceil((1000 * XML_SCAN_CHARGE_CHARS) / PIECE) + 1,
    );
    expect(budget.messages).toBe(1001);
  });
  it("stops an attribute-heavy file at the message cap", async () => {
    const budget = new ActivityBudget({ messages: 40 });
    const element = `<a ${"b".repeat(8000)}="${"c".repeat(8000)}" d="${" ".repeat(370)}"/>`;
    const { chunks, pulled } = source("<gpx>", () => element, 1024, "</gpx>");
    expect(await drain(budget, chunks)).toEqual([]);
    expect(budget.warnings).toContain("message-cap-exceeded");
    // Each ~16 KiB element costs 32 scan charges plus its two events.
    expect(pulled.pieces).toBeLessThanOrEqual(2);
  });
});

describe("TCX trackpoint times", () => {
  it("starts at the earliest point and ends at the latest, in any order", async () => {
    const point = (time: string) => `<Trackpoint><Time>${time}</Time></Trackpoint>`;
    const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-06-01T06:30:00Z</Id><Lap StartTime="2026-06-01T06:30:00Z"><Track>${point("2026-06-01T06:31:00Z")}${point("2026-06-01T06:00:00Z")}${point("2026-06-01T06:30:30Z")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    async function* one() {
      yield xml;
    }
    const [activity] = await drain(new ActivityBudget(), one());
    expect(activity?.start).toBe(Date.parse("2026-06-01T06:00:00Z"));
    expect(activity?.end).toBe(Date.parse("2026-06-01T06:31:00Z"));
    expect(activity?.duration).toBe(1860);
  });
  it("keeps an earlier <Id> as the start and still ends at the latest point", async () => {
    const point = (time: string) => `<Trackpoint><Time>${time}</Time></Trackpoint>`;
    const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-06-01T06:29:00Z</Id><Lap><Track>${point("2026-06-01T06:31:00Z")}${point("2026-06-01T06:30:00Z")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    async function* one() {
      yield xml;
    }
    const [activity] = await drain(new ActivityBudget(), one());
    expect(activity?.start).toBe(Date.parse("2026-06-01T06:29:00Z"));
    expect(activity?.end).toBe(Date.parse("2026-06-01T06:31:00Z"));
  });
});
