// AUTHORED-BY Claude Opus 5.5
//
// Pins where the generated Suite Calendar entities differ from the Suite Calendar app's
// hand-written model (apps/suite/src/apps/calendar/lib/model/rdf.ts before sst-q6hu).
// README "Suite Calendar" > "Exact divergences" lists them.
import { DataFactory, Parser, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildCalendarDocument,
  buildCalendarEventFields,
  isCalendarDocument,
  isCalendarEvent,
  parseCalendarDocument,
  parseCalendarEventFields,
} from "../src/index.js";

const URL_ = "https://pod.example/calendar/work.ttl";

function store(body: string): Store {
  const ttl = `
    @prefix jsched: <https://jeswr.org/ns/sectors/scheduling#> .
    @prefix schema: <https://schema.org/> .
    @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    ${body}`;
  return new Store(new Parser({ baseIRI: URL_ }).parse(ttl));
}

it("no longer treats a w3id sched:Calendar as a Suite calendar document", () => {
  // The app canonicalised every legacy namespace; the w3id class is this package's own
  // Vikunja calendar (sched:summary, not dct:title), so it cannot be a read alias.
  const legacy = store(`<#it> a sched:Calendar; dct:title "Work".`);
  expect(isCalendarDocument(URL_, legacy)).toBe(false);
  expect(parseCalendarDocument(URL_, legacy)).toBeUndefined();
});

it("recognises a data-graph subclass of the calendar and event classes", () => {
  expect(
    parseCalendarDocument(
      URL_,
      store(`<#it> a <#Sub>; dct:title "W". <#Sub> rdfs:subClassOf jsched:Calendar.`),
    ),
  ).toEqual({ title: "W" });
  expect(isCalendarEvent(URL_, store(`<#it> a <#Sub>. <#Sub> rdfs:subClassOf schema:Event.`))).toBe(
    true,
  );
});

it("drops an ambiguous or non-xsd:string value instead of reading the first term", () => {
  expect(parseCalendarDocument(URL_, store(`<#it> a jsched:Calendar; dct:title "A", "B".`))).toBe(
    undefined,
  );
  expect(parseCalendarDocument(URL_, store(`<#it> a jsched:Calendar; dct:title "A"@en.`))).toBe(
    undefined,
  );
  expect(
    parseCalendarDocument(
      URL_,
      store(`<#it> a jsched:Calendar; dct:title "W"; schema:color "a", "b".`),
    ),
  ).toEqual({ title: "W" });
  expect(
    parseCalendarEventFields(
      URL_,
      store(`<#it> a jsched:CalendarEvent; schema:name "A", "B"; schema:location <https://x.example/>;
        schema:description "d"@en; schema:identifier 7.`),
    ),
  ).toEqual({});
});

it("strips control characters from written title, colour, location and description", () => {
  const doc = buildCalendarDocument(URL_, { title: "W\u0001", color: "red\u0007" });
  expect(parseCalendarDocument(URL_, doc)).toEqual({ title: "W", color: "red" });
  const event = buildCalendarEventFields(URL_, {
    name: "N\u0001",
    location: "L\u0001",
    description: "D\u0001",
    uid: "U\u0001",
    timeZone: "Z\u0001",
  });
  // name stays byte-equal to the app-written jsched:summary; uid and zone keep identity.
  expect(parseCalendarEventFields(URL_, event)).toEqual({
    name: "N\u0001",
    location: "L",
    description: "D",
    uid: "U\u0001",
    timeZone: "Z\u0001",
  });
});

it("writes the generated event fields before the type the facade adds", () => {
  const s = buildCalendarEventFields(URL_, { description: "d", name: "n", timeZone: "UTC" });
  // Store order drives Turtle order: generated fields in manifest order, then the app's.
  expect([...s].map((q) => q.predicate.value.replace(/^.*[#/]/, ""))).toEqual([
    "type",
    "type",
    "timeZone",
    "description",
    "name",
  ]);
  expect(new Set([...s].map((q) => q.subject))).toEqual(
    new Set([DataFactory.namedNode(`${URL_}#it`)]),
  );
});
