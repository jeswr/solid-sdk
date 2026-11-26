// AUTHORED-BY Claude Sonnet 5.5
import { DataFactory, type Store } from "n3";
import { expect, it } from "vitest";
import {
  buildCalendar,
  buildEvent,
  type CalendarEvent,
  deserializeDataset,
  parseCalendar,
  parseEvent,
  serializeDataset,
} from "../src/apps/calendar/lib/model";

const { namedNode, blankNode, literal, quad } = DataFactory;
const SCHEMA = "https://schema.org/";
const url = "https://pod.example/calendar/event.ttl";

const event: CalendarEvent = {
  name: "Planning",
  start: new Date("2026-03-01T10:00:00Z"),
  end: new Date("2026-03-01T11:00:00Z"),
} as unknown as CalendarEvent;

function subjectOf(store: Store, predicate: string) {
  const subject = [...store.match(null, namedNode(predicate), null)][0]?.subject;
  if (subject?.termType !== "NamedNode") throw new Error(`no named subject for ${predicate}`);
  return namedNode(subject.value);
}

function eventWith(predicate: string, object: "iri" | "bnode") {
  const store = buildEvent(url, event) as Store;
  const subject = subjectOf(store, `${SCHEMA}name`);
  for (const q of store.match(subject, namedNode(`${SCHEMA}${predicate}`), null))
    store.removeQuad(q);
  const term = object === "iri" ? namedNode("https://maps.example/p/1") : blankNode("place");
  store.addQuad(quad(subject, namedNode(`${SCHEMA}${predicate}`), term));
  if (object === "bnode") {
    store.addQuad(
      quad(
        term,
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode(`${SCHEMA}Place`),
      ),
    );
    store.addQuad(quad(term, namedNode(`${SCHEMA}name`), literal("Room 4")));
  }
  return store;
}

it.each(["iri", "bnode"] as const)("does not read a %s location as text", (kind) => {
  const parsed = parseEvent(url, eventWith("location", kind));
  expect(parsed?.name).toBe("Planning");
  expect(parsed?.location).toBeUndefined();
});

it("keeps a blank-node Place when a literal fallback exists beside it", () => {
  const store = eventWith("location", "bnode");
  const subject = subjectOf(store, `${SCHEMA}name`);
  store.addQuad(quad(subject, namedNode(`${SCHEMA}location`), literal("Room 4 text")));
  expect(parseEvent(url, store)?.location).toBe("Room 4 text");
});

it.each(["iri", "bnode"] as const)("does not read a %s event name as text", (kind) => {
  const store = eventWith("name", kind);
  let parsed: ReturnType<typeof parseEvent>;
  try {
    parsed = parseEvent(url, store);
  } catch {
    return; // missing title fails validation rather than becoming IRI text
  }
  expect(parsed?.name).not.toMatch(/^(https:\/\/maps|n3-)/);
});

it.each(["iri", "bnode"] as const)("does not read a %s calendar title as text", async (kind) => {
  const calUrl = "https://pod.example/calendar/cal.ttl";
  const store = buildCalendar(calUrl, { title: "Work", color: `#${"112233"}` } as never) as Store;
  const title = namedNode("http://purl.org/dc/terms/title");
  const subject = subjectOf(store, title.value);
  for (const q of store.match(subject, title, null)) store.removeQuad(q);
  store.addQuad(
    quad(subject, title, kind === "iri" ? namedNode("https://maps.example/p/1") : blankNode("t")),
  );
  const dataset = await deserializeDataset(await serializeDataset(store), calUrl);
  let parsed: ReturnType<typeof parseCalendar>;
  try {
    parsed = parseCalendar(calUrl, dataset);
  } catch {
    return;
  }
  expect(parsed?.title ?? "").not.toMatch(/^(https:\/\/maps|n3-|b\d)/);
});
