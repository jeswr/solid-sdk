// AUTHORED-BY Codex GPT-6.1-Sol
import { createFactAssertion, type Fact } from "@jeswr/pkg-memory";
import { describe, expect, it } from "vitest";
import { healthTimeline, observationSeries, projectHealthFacts } from "../src/index.js";
import { batch, claim, condition, FixtureNode, H, observation, owner, X } from "./helpers.js";

describe("temporal values", () => {
  it.each([
    ["date", "2024-02-29", "2024-02-29T00:00:00Z"],
    ["gYearMonth", "2024-02", "2024-02-01T00:00:00Z"],
    ["gYear", "2024", "2024-01-01T00:00:00Z"],
    ["dateTime", "2024-02-29T10:00:00+02:00", "2024-02-29T08:00:00Z"],
    ["dateTime", "2024-02-29T10:00:00", "2024-02-29T10:00:00Z"],
    ["dateTime", "2024-02-29T10:00:00.123456Z", "2024-02-29T10:00:00.123Z"],
  ] as const)("retains %s precision and lexical bounds", async (datatype, value, iso) => {
    const fact: Fact = {
      template: "condition",
      value: {
        id: "https://example.org/entities/dates",
        name: "Fictional dated condition",
        validFrom: { datatype, value },
        validThrough: { datatype, value },
      },
    };
    const view = projectHealthFacts(await batch([claim("dates", fact)]), { owner });
    const parsed = view.facts[0];
    expect(parsed?.period.startTime).toBe(Date.parse(iso));
    expect(parsed?.period.endTime).toBe(Date.parse(iso));
    if (datatype !== "dateTime") expect(parsed?.period.start).toBe(value);
    expect(parsed).toMatchObject({ onset: parsed?.period.start, abatement: parsed?.period.end });
  });
  it("has an empty period when none is recorded, and keeps malformed temporal values lexical only", async () => {
    const bad = createFactAssertion(owner, condition());
    new FixtureNode("https://example.org/entities/condition", bad)
      .text("https://schema.org/validFrom", "2023-02-29", `${X}date`)
      .text("https://schema.org/validThrough", "not a date", `${X}date`);
    const view = projectHealthFacts(
      await batch([
        { ...claim("bad"), assertion: bad },
        claim("absent", condition("Undated", "absent")),
      ]),
      { owner },
    );
    expect(view.facts.find((f) => f.label === "Undated")?.period).toEqual({
      start: undefined,
      end: undefined,
      startTime: undefined,
      endTime: undefined,
    });
    const period = view.facts.find((f) => f.label !== "Undated")?.period;
    expect(period).toEqual({
      start: "2023-02-29",
      end: "not a date",
      startTime: undefined,
      endTime: undefined,
    });
  });
});
describe("chart helpers", () => {
  it("groups numeric values by code and unit, sorts dates and reports skips", async () => {
    const inputs = [
      observation({ id: "later", date: "2025-04-02T10:00:00Z", value: "75", code: "8867-4" }),
      observation({
        id: "earlier",
        date: "2025-04-01T10:00:00Z",
        value: "72.5",
        datatype: "decimal",
        code: "8867-4",
      }),
      observation({
        id: "different-unit",
        date: "2025-04-03T10:00:00Z",
        unit: "Hz",
        code: "8867-4",
      }),
      observation({ id: "text", date: "2025-04-01T10:00:00Z", value: "72", datatype: "string" }),
      observation({ id: "undated" }),
      observation({ id: "invalid-date", date: "2025-02-30T10:00:00Z" }),
    ];
    // Invalid dateTimes are rejected by pkg-memory before projection; use an invalid xsd:date instead.
    inputs[5] = observation({ id: "invalid-date", date: "2025-02-30", dateType: "date" });
    const view = projectHealthFacts(
      await batch(inputs.map((assertion, i) => ({ ...claim(String(i)), assertion }))),
      { owner },
    );
    const result = observationSeries(view);
    expect(view.byKind.observation).toHaveLength(6);
    expect(result.skipped).toBe(2);
    expect(result.series).toHaveLength(3);
    const heart = result.series.find((s) => s.unit === "/min" && s.points.length === 2);
    expect(heart?.points.map((p) => p.y)).toEqual([72.5, 75]);
    expect(heart?.points.map((p) => p.x)).toEqual([
      "2025-04-01T10:00:00.000Z",
      "2025-04-02T10:00:00.000Z",
    ]);
    expect(heart?.points.every((p) => view.facts.some((f) => f.id === p.factId))).toBe(true);
    expect(observationSeries(view, { beliefs: [] })).toEqual({ series: [], skipped: 0 });
  });
  it("normalizes labels, uses period times, keeps past observations and filters beliefs", async () => {
    const one = observation({
      id: "one",
      label: "  Heart   Rate ",
      value: "0",
      date: "2024",
      dateType: "gYear",
    });
    const two = observation({ id: "two", label: "heart rate", value: "75" });
    new FixtureNode("https://example.org/observations/two", two).text(
      "https://schema.org/validFrom",
      "2025-02",
      `${X}gYearMonth`,
    );
    const view = projectHealthFacts(
      await batch([
        { ...claim("one"), assertion: one },
        { ...claim("two"), assertion: two, validity: "Historical" },
      ]),
      { owner },
    );
    expect(observationSeries(view).series[0]?.points.map((p) => p.y)).toEqual([0, 75]);
    expect(observationSeries(view, { beliefs: ["definitely"] }).series[0]?.points).toHaveLength(1);
  });
  it("keeps an observation missing a usable value in unrecognised, preserving metadata", async () => {
    const graph = observation();
    const term = graph.getSubjects(null, null, null)[0];
    if (!term) throw new Error("Missing fixture");
    graph.removeQuads(graph.getQuads(term, `${H}value`, null, null));
    const view = projectHealthFacts(await batch([{ ...claim("missing"), assertion: graph }]), {
      owner,
    });
    expect(view.byKind.observation).toEqual([]);
    expect(view.unrecognised).toHaveLength(1);
  });
  it("uses active, past and neutral tones and preserves missing bounds", async () => {
    const view = projectHealthFacts(
      await batch([
        claim("active"),
        { ...claim("past", condition("Historical", "past")), validity: "Historical" },
        { ...claim("neutral", condition("Contradicted", "neutral")), validity: "Contradicted" },
        claim("ended", {
          template: "condition",
          value: {
            id: "https://example.org/entities/ended",
            name: "Ended",
            validThrough: { datatype: "gYear", value: "2024" },
          },
        }),
      ]),
      { owner },
    );
    const lanes = healthTimeline(view);
    expect(lanes.condition.map((i) => i.tone).sort()).toEqual([
      "active",
      "neutral",
      "past",
      "past",
    ]);
    expect(lanes.condition.find((i) => i.label === "Fictional condition")).toMatchObject({
      start: undefined,
      end: undefined,
    });
    expect(healthTimeline(view, { beliefs: ["definitely"] }).condition).toHaveLength(2);
    expect(lanes.medication).toEqual([]);
    expect(lanes.encounter).toEqual([]);
    expect(lanes.immunization).toEqual([]);
  });
});
