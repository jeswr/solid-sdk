// AUTHORED-BY Claude Opus 5.5
//
// The Suite Calendar entities (calendar documents and the generated event fields) write
// the exact IRIs the Suite Calendar app has always written, and read its legacy aliases.
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildCalendarDocument,
  buildCalendarEventFields,
  CalendarDocumentView,
  CalendarEventView,
  isCalendarDocument,
  isCalendarEvent,
  parseCalendarDocument,
  parseCalendarEventFields,
  SCHEMA_EVENT_CLASS,
  SUITE_CALENDAR_CLASS,
  SUITE_EVENT_CLASS,
} from "../src/index.js";

const URL_ = "https://pod.example/calendar/work.ttl";
const IT = `${URL_}#it`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function store(body: string): Store {
  const ttl = `
    @prefix jsched: <https://jeswr.org/ns/sectors/scheduling#> .
    @prefix schema: <https://schema.org/> .
    @prefix sc: <http://schema.org/> .
    @prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
    @prefix dct: <http://purl.org/dc/terms/> .
    ${body}`;
  return new Store(new Parser({ baseIRI: URL_ }).parse(ttl));
}

const triples = (s: Store) =>
  [...s].map((q) => [q.subject.value, q.predicate.value, q.object.value]).sort();

describe("calendar documents", () => {
  it("writes #it a jsched:Calendar with dct:title and schema:color", () => {
    const s = buildCalendarDocument(URL_, { title: "Work", color: "#123abc" });
    expect(triples(s)).toEqual(
      [
        [IT, RDF_TYPE, SUITE_CALENDAR_CLASS],
        [IT, "http://purl.org/dc/terms/title", "Work"],
        [IT, "https://schema.org/color", "#123abc"],
      ].sort(),
    );
    expect(
      [...s].every(
        (q) => q.object.termType !== "Literal" || q.object.datatype.value === XSD_STRING,
      ),
    ).toBe(true);
    expect(parseCalendarDocument(URL_, s)).toEqual({ title: "Work", color: "#123abc" });
    expect(isCalendarDocument(URL_, s)).toBe(true);
  });

  it("omits an undefined colour and reads the http://schema.org alias", () => {
    expect(
      parseCalendarDocument(URL_, buildCalendarDocument(URL_, { title: "W", color: undefined })),
    ).toEqual({
      title: "W",
    });
    expect(
      parseCalendarDocument(URL_, store(`<#it> a jsched:Calendar; dct:title "W"; sc:color "red".`)),
    ).toEqual({
      title: "W",
      color: "red",
    });
  });

  it("requires exactly one title and recognises nothing else", () => {
    expect(parseCalendarDocument(URL_, store(`<#it> a jsched:Calendar.`))).toBeUndefined();
    expect(isCalendarDocument(URL_, store(`<#it> a jsched:Calendar.`))).toBe(true);
    expect(
      parseCalendarDocument(URL_, store(`<#it> a jsched:CalendarEvent; dct:title "x".`)),
    ).toBeUndefined();
    expect(isCalendarDocument("not a url", new Store())).toBe(false);
    expect(parseCalendarDocument(`${URL_}#frag`, new Store())).toBeUndefined();
    expect(() => buildCalendarDocument(`${URL_}#frag`, { title: "x" })).toThrow(TypeError);
  });

  it("clears fields through the generated view", () => {
    const s = buildCalendarDocument(URL_, { title: "Work", color: "blue" });
    const view = new CalendarDocumentView(IT, s, DataFactory);
    view.color = undefined;
    expect(view.color).toBeUndefined();
    expect(view.title).toBe("Work");
  });
});

describe("calendar event fields", () => {
  const fields = {
    name: "Meeting",
    location: "Home",
    description: "Notes",
    uid: "unique",
    timeZone: "Europe/London",
  };

  it("writes both event classes and the exact schema.org / jsched predicates", () => {
    const s = buildCalendarEventFields(URL_, { ...fields, description: undefined });
    expect(triples(s)).toEqual(
      [
        [IT, RDF_TYPE, SUITE_EVENT_CLASS],
        [IT, RDF_TYPE, SCHEMA_EVENT_CLASS],
        [IT, "https://schema.org/name", "Meeting"],
        [IT, "https://schema.org/location", "Home"],
        [IT, "https://schema.org/identifier", "unique"],
        [IT, "https://jeswr.org/ns/sectors/scheduling#timeZone", "Europe/London"],
      ].sort(),
    );
    expect(parseCalendarEventFields(URL_, buildCalendarEventFields(URL_, fields))).toEqual(fields);
  });

  it("recognises the Pod Manager, http schema.org and w3id event classes", () => {
    for (const type of [
      "schema:Event",
      "sc:Event",
      "sched:CalendarEvent",
      "jsched:CalendarEvent",
    ]) {
      expect(isCalendarEvent(URL_, store(`<#it> a ${type}.`))).toBe(true);
    }
    expect(isCalendarEvent(URL_, store(`<#it> a jsched:Calendar.`))).toBe(false);
    expect(
      parseCalendarEventFields(URL_, store(`<#it> a jsched:Calendar; schema:name "x".`)),
    ).toBeUndefined();
  });

  it("reads legacy aliases canonical-first and writes canonical only", () => {
    const s = store(
      `<#it> a sc:Event; sc:name "Old"; sc:location "There"; sched:timeZone "UTC"; schema:location "Here".`,
    );
    expect(parseCalendarEventFields(URL_, s)).toEqual({
      name: "Old",
      location: "Here",
      timeZone: "UTC",
    });
    const view = new CalendarEventView(IT, s, DataFactory);
    view.name = "New";
    view.timeZone = undefined;
    expect(parseCalendarEventFields(URL_, s)).toEqual({ name: "New", location: "Here" });
    expect([...s].some((q) => q.predicate.value === "http://schema.org/name")).toBe(false);
    expect([...s].some((q) => q.predicate.value.startsWith("https://w3id.org/"))).toBe(false);
  });
});
