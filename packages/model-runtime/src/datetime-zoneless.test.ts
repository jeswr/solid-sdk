// AUTHORED-BY Claude Opus 5.5
//
// A zoneless xsd:dateTime has no timezone. The runtime reads it as UTC, so the
// instant never depends on the host's local time zone. Each case runs under a
// non-UTC zone and first proves the zone is in effect (Vitest's default forks
// pool gives each file its own process, where setting TZ changes Date's zone; in
// a worker thread it would not, and the offset assertion would fail loudly).
import { DataFactory, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import { defineModel } from "./model.js";

const EX = "http://ex.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const model = defineModel({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: { ex: EX, xsd: XSD },
  entities: [
    {
      name: "Event",
      typeIris: [`${EX}Event`],
      subject: { convention: "self" as const },
      fields: [
        {
          name: "when",
          predicate: `${EX}when`,
          kind: "literal" as const,
          datatype: "xsd:dateTime",
          maxCount: 1,
        },
      ],
    },
  ],
});
const Event_ = model.entities.Event;
if (!Event_) throw new Error("Event entity missing");
const RES = `${EX}events/1`;

function read(lexical: string): Date | undefined {
  const store = new Store();
  const subject = DataFactory.namedNode(Event_?.subject(RES) ?? RES);
  store.addQuad(subject, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${EX}Event`));
  store.addQuad(
    subject,
    DataFactory.namedNode(`${EX}when`),
    DataFactory.literal(lexical, DataFactory.namedNode(`${XSD}dateTime`)),
  );
  return Event_?.parse(RES, store)?.when as Date | undefined;
}

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const CASES: [string, string][] = [
  ["2026-11-11T10:00:00", "2026-11-11T10:00:00.000Z"],
  ["2026-03-08T02:30:00", "2026-03-08T02:30:00.000Z"], // New York spring-forward gap
  ["2026-11-01T01:30:00", "2026-11-01T01:30:00.000Z"], // New York repeated autumn hour
  ["2026-11-11T10:00:00.250", "2026-11-11T10:00:00.250Z"],
  ["12026-01-01T00:00:00", "+012026-01-01T00:00:00.000Z"], // expanded year
  ["-0001-06-01T12:00:00", "-000001-06-01T12:00:00.000Z"], // negative year
];

for (const [zone, offset] of [
  ["America/New_York", 300],
  ["Asia/Kolkata", -330],
] as const) {
  describe(`zoneless xsd:dateTime under TZ=${zone}`, () => {
    it("has the zone in effect", () => {
      process.env.TZ = zone;
      expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(offset);
    });
    for (const [lexical, instant] of CASES) {
      it(`reads "${lexical}" as UTC`, () => {
        process.env.TZ = zone;
        expect(read(lexical)?.toISOString()).toBe(new Date(instant).toISOString());
      });
    }
    it("leaves explicitly zoned values unchanged", () => {
      process.env.TZ = zone;
      expect(read("2026-11-11T10:00:00+05:30")?.toISOString()).toBe("2026-11-11T04:30:00.000Z");
      expect(read("2026-11-11T10:00:00Z")?.toISOString()).toBe("2026-11-11T10:00:00.000Z");
    });
    it("still drops a zoneless value outside the Date range", () => {
      process.env.TZ = zone;
      expect(read("275760-09-13T00:00:01")).toBeUndefined();
    });
    it("reads the maximum zoneless instant as UTC", () => {
      process.env.TZ = zone;
      expect(read("275760-09-13T00:00:00")?.getTime()).toBe(8.64e15);
    });
  });
}
