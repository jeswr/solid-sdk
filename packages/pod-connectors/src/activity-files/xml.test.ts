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
  it("calls onScan once per 64 Ki characters, inside comments too", async () => {
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
  it("stops a 16 MiB comment bomb at the message cap", async () => {
    const budget = new ActivityBudget({ messages: 8 });
    const { chunks, pulled } = source("<gpx><!--", () => "x".repeat(PIECE), 1024, "--></gpx>");
    expect(await drain(budget, chunks)).toEqual([]);
    expect(budget.warnings).toContain("message-cap-exceeded");
    // Eight messages cover at most 8 * 64 Ki characters (plus the root's events).
    expect(pulled.pieces * PIECE).toBeLessThanOrEqual(9 * XML_SCAN_CHARGE_CHARS);
  });
  it("stops an attribute-heavy file at the message cap", async () => {
    const budget = new ActivityBudget({ messages: 40 });
    const element = `<a ${"b".repeat(8000)}="${"c".repeat(8000)}" d="${" ".repeat(370)}"/>`;
    const { chunks, pulled } = source("<gpx>", () => element, 1024, "</gpx>");
    expect(await drain(budget, chunks)).toEqual([]);
    expect(budget.warnings).toContain("message-cap-exceeded");
    expect(pulled.pieces).toBeLessThan(40);
  });
});
