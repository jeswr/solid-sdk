// AUTHORED-BY Claude Opus 5.5
/**
 * The **Suite Calendar** model: the calendar documents and calendar events the Suite
 * Calendar app writes, on the exact IRIs pods already hold (the re-minted
 * `https://jeswr.org/ns/sectors/scheduling#` namespace plus `https://schema.org/` and
 * `dct:`). A facade over the `CalendarDocument` and `CalendarEvent` entities GENERATED
 * from `codegen/` (`./generated/`), so type recognition, read aliases, datatype and
 * cardinality guards run in the audited `@jeswr/model-runtime`.
 *
 * Facade policy (what the generator cannot express, see `codegen/scheduling.shapes.ttl`):
 * an event is written with BOTH `jsched:CalendarEvent` and `schema:Event` (a generated
 * entity stamps one class; the second is the Pod Manager interop type). The event's
 * dates, `jsched:summary`, `jsched:inCalendar`, recurrence and reminders are not
 * generated; the Suite app keeps them.
 */

import type { EntityWrapper } from "@jeswr/model-runtime";
import type { DatasetCore, DataFactory as RdfDataFactory, Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { type CalendarDocumentData, type CalendarEventData, entities } from "./generated/model.js";
import { assertResourceUrl, isResourceUrl } from "./iri.js";

export type { CalendarDocumentData, CalendarEventData as CalendarEventFields };

/** Optional fields that also accept an explicit `undefined` (clear / absent). */
type Clearable<T> = { [K in keyof T]?: T[K] | undefined };

/** Build input for a calendar document; an `undefined` colour is omitted. */
export type CalendarDocumentInput = { title: string } & Clearable<
  Omit<CalendarDocumentData, "title">
>;
/** Build input for the generated event fields; `undefined` fields are omitted. */
export type CalendarEventInput = Clearable<CalendarEventData>;

/** A view whose setters take `undefined` to clear the field. */
type View<T> = new (
  term: string | Term,
  dataset: DatasetCore,
  factory: RdfDataFactory,
) => EntityWrapper & Clearable<T>;

/** The re-minted scheduling namespace the Suite Calendar writes. */
export const SUITE_SCHED = "https://jeswr.org/ns/sectors/scheduling#";
/** `jsched:Calendar` — a Suite calendar document. */
export const SUITE_CALENDAR_CLASS = `${SUITE_SCHED}Calendar`;
/** `jsched:CalendarEvent` — a Suite calendar event. */
export const SUITE_EVENT_CLASS = `${SUITE_SCHED}CalendarEvent`;
/** `schema:Event` — the second class every Suite event is written with. */
export const SCHEMA_EVENT_CLASS = "https://schema.org/Event";

/** Generated typed view of a calendar document subject (`title`, `color`). */
export const CalendarDocumentView: View<CalendarDocumentData> = entities.CalendarDocument.Wrapper;
/** Generated typed view of an event subject (`name`, `location`, `description`, `uid`, `timeZone`). */
export const CalendarEventView: View<CalendarEventData> = entities.CalendarEvent.Wrapper;

/** Build a calendar document (`#it a jsched:Calendar; dct:title; schema:color`). */
export function buildCalendarDocument(resourceUrl: string, data: CalendarDocumentInput): Store {
  return entities.CalendarDocument.build(assertResourceUrl(resourceUrl), data);
}

/** Whether `#it` is a calendar document (canonical class or a data-graph subclass). */
export function isCalendarDocument(resourceUrl: string, dataset: DatasetCore): boolean {
  return (
    isResourceUrl(resourceUrl) &&
    new CalendarDocumentView(`${resourceUrl}#it`, dataset, DataFactory).isInstance
  );
}

/** Read a calendar document, or `undefined` unless it is one with exactly one title. */
export function parseCalendarDocument(
  resourceUrl: string,
  dataset: DatasetCore,
): CalendarDocumentData | undefined {
  return isResourceUrl(resourceUrl)
    ? entities.CalendarDocument.parse(resourceUrl, dataset)
    : undefined;
}

/**
 * Build the generated fields of an event and type it `jsched:CalendarEvent` and
 * `schema:Event`. The caller adds the fields this model does not generate.
 */
export function buildCalendarEventFields(resourceUrl: string, data: CalendarEventInput): Store {
  const url = assertResourceUrl(resourceUrl);
  const store = entities.CalendarEvent.build(url, data);
  new CalendarEventView(`${url}#it`, store, DataFactory).types.add(SCHEMA_EVENT_CLASS);
  return store;
}

/**
 * Whether `#it` is an event: `jsched:CalendarEvent`, a read-only legacy alias
 * (`schema:Event`, `http://schema.org/Event`, the w3id `sched:CalendarEvent`) or a
 * data-graph subclass of one.
 */
export function isCalendarEvent(resourceUrl: string, dataset: DatasetCore): boolean {
  return (
    isResourceUrl(resourceUrl) &&
    new CalendarEventView(`${resourceUrl}#it`, dataset, DataFactory).isInstance
  );
}

/** Read the generated event fields, or `undefined` unless `#it` is an event. */
export function parseCalendarEventFields(
  resourceUrl: string,
  dataset: DatasetCore,
): CalendarEventData | undefined {
  return isResourceUrl(resourceUrl)
    ? entities.CalendarEvent.parse(resourceUrl, dataset)
    : undefined;
}
