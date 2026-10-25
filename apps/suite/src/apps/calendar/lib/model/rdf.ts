// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { canonicalize, LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  type Calendar,
  type CalendarDate,
  type CalendarEvent,
  type RecurrenceRule,
  type Reminder,
  WEEKDAYS,
  type Weekday,
} from "./types";
import {
  httpIri,
  validateCalendar,
  validateEvent,
  validateReminder,
  validateRule,
} from "./validation";

export { NS } from "@jeswr/suite-vocab";
export const CALENDAR_CLASS = `${NS.SCHEDULING}Calendar`;
export const EVENT_CLASS = `${NS.SCHEDULING}CalendarEvent`;
const s = NS.SCHEMA,
  c = NS.SCHEDULING;
function aliases(predicate: string): string[] {
  return [
    ...new Set([
      predicate,
      ...Object.entries(LEGACY_NAMESPACES)
        .filter(([, base]) => predicate.startsWith(base))
        .map(([legacy, base]) => legacy + predicate.slice(base.length)),
    ]),
  ];
}
function wrapperIdentity(t: TermWrapper): TermWrapper {
  return t;
}
function wrapperTerm(t: TermWrapper): Term {
  return t as unknown as Term;
}
/** Shared typed accessor mechanics; aliases apply only to vocabulary, never resource IDs. */
export class ModelNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.RDF}type`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  hasType(type: string): boolean {
    return [...this.types].some((t) => canonicalize(t) === type);
  }
  read<T>(p: string, map: (t: TermWrapper) => T): T | undefined {
    for (const predicate of aliases(p)) {
      const value = OptionalFrom.subjectPredicate(this, predicate, map);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  text(p: string): string | undefined {
    return this.read(p, LiteralAs.string);
  }
  setText(p: string, v: string | undefined): void {
    OptionalAs.object(this, p, v, LiteralFrom.string);
  }
  iri(p: string): string | undefined {
    return this.read(p, NamedNodeAs.string);
  }
  setIri(p: string, v: string | undefined): void {
    OptionalAs.object(this, p, v === undefined ? undefined : httpIri(v), NamedNodeFrom.string);
  }
  date(p: string): CalendarDate | undefined {
    return this.read(p, (t) => this.dateValue(t));
  }
  dateValue(t: TermWrapper): CalendarDate {
    const date = LiteralAs.date(t);
    return t.datatype.value === `${NS.XSD}date` ? t.value : date;
  }
  setDate(p: string, v: CalendarDate | undefined): void {
    OptionalAs.object(this, p, v, (date, f) =>
      f.literal(
        typeof date === "string" ? date : date.toISOString(),
        f.namedNode(`${NS.XSD}${typeof date === "string" ? "date" : "dateTime"}`),
      ),
    );
  }
  number(p: string): number | undefined {
    return this.read(p, LiteralAs.number);
  }
  setNumber(p: string, v: number | undefined, positive = false): void {
    OptionalAs.object(this, p, v, (n, f) =>
      f.literal(String(n), f.namedNode(`${NS.XSD}${positive ? "positiveInteger" : "integer"}`)),
    );
  }
  values<T>(p: string, map: (t: TermWrapper) => T): T[] {
    return aliases(p).flatMap((predicate) =>
      [...SetFrom.subjectPredicate(this, predicate, wrapperIdentity, wrapperTerm)].map(map),
    );
  }
  nodes(p: string): ModelNode[] {
    return this.values(p, (t) => new ModelNode(t as unknown as Term, this.dataset, this.factory));
  }
  link(p: string): ModelNode {
    const node = new ModelNode(this.factory.blankNode(), this.dataset, this.factory);
    SetFrom.subjectPredicate(this, p, wrapperIdentity, wrapperTerm).add(node);
    return node;
  }
}
export class CalendarDoc extends ModelNode {
  get title() {
    return this.text(`${NS.DCT}title`);
  }
  set title(v: string | undefined) {
    this.setText(`${NS.DCT}title`, v);
  }
  get color() {
    return this.text(`${s}color`);
  }
  set color(v: string | undefined) {
    this.setText(`${s}color`, v);
  }
}
export class EventDoc extends ModelNode {
  get name() {
    return this.text(`${s}name`);
  }
  set name(v: string | undefined) {
    this.setText(`${s}name`, v);
  }
  get start() {
    return this.date(`${s}startDate`) ?? this.date(`${c}startTime`);
  }
  set start(v: CalendarDate | undefined) {
    this.setDate(`${s}startDate`, v);
    this.setDate(`${c}startTime`, v);
  }
  get end() {
    return this.date(`${s}endDate`) ?? this.date(`${c}endTime`);
  }
  set end(v: CalendarDate | undefined) {
    this.setDate(`${s}endDate`, v);
    this.setDate(`${c}endTime`, v);
  }
  get location() {
    return this.text(`${s}location`);
  }
  set location(v: string | undefined) {
    this.setText(`${s}location`, v);
  }
  get description() {
    return this.text(`${s}description`);
  }
  set description(v: string | undefined) {
    this.setText(`${s}description`, v);
  }
  get inCalendar() {
    return this.iri(`${c}inCalendar`);
  }
  set inCalendar(v: string | undefined) {
    this.setIri(`${c}inCalendar`, v);
  }
  get uid() {
    return this.text(`${s}identifier`);
  }
  set uid(v: string | undefined) {
    this.setText(`${s}identifier`, v);
  }
}
export function writeRule(node: ModelNode, rule: RecurrenceRule): void {
  validateRule(rule);
  node.types.add(`${c}RecurrenceRule`);
  node.setText(`${c}frequency`, rule.frequency);
  node.setNumber(`${c}interval`, rule.interval, true);
  node.setNumber(`${c}count`, rule.count, true);
  node.setDate(`${c}until`, rule.until);
  const days = SetFrom.subjectPredicate(
    node,
    `${s}byDay`,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  days.clear();
  for (const day of rule.byDay ?? []) days.add(`${s}${WEEKDAYS[day]}`);
  for (const [p, values] of [
    ["byMonthDay", rule.byMonthDay],
    ["byMonth", rule.byMonth],
  ] as const) {
    const set = SetFrom.subjectPredicate(node, s + p, LiteralAs.number, LiteralFrom.integer);
    set.clear();
    for (const value of values ?? []) set.add(value);
  }
  const exceptions = SetFrom.subjectPredicate(
    node,
    `${s}exceptDate`,
    node.dateValue,
    (value: CalendarDate, f) =>
      f.literal(
        typeof value === "string" ? value : value.toISOString(),
        f.namedNode(`${NS.XSD}${typeof value === "string" ? "date" : "dateTime"}`),
      ),
  );
  exceptions.clear();
  for (const date of rule.exceptDate ?? []) exceptions.add(date);
}
export function readRule(node: ModelNode): RecurrenceRule {
  const rule: RecurrenceRule = {
    frequency: node.text(`${c}frequency`) as RecurrenceRule["frequency"],
    interval: node.number(`${c}interval`),
    count: node.number(`${c}count`),
    until: node.date(`${c}until`),
    byDay: node.values(`${s}byDay`, (t) => {
      const iri = canonicalize(NamedNodeAs.string(t));
      const day = (Object.keys(WEEKDAYS) as Weekday[]).find((d) => `${s}${WEEKDAYS[d]}` === iri);
      if (!day) throw new TypeError("Invalid weekday IRI");
      return day;
    }),
    byMonthDay: node.values(`${s}byMonthDay`, LiteralAs.number).sort((a, b) => a - b),
    byMonth: node.values(`${s}byMonth`, LiteralAs.number).sort((a, b) => a - b),
    exceptDate: node.values(`${s}exceptDate`, (t) => node.dateValue(t)),
  };
  validateRule(rule);
  return rule;
}
export function writeReminder(node: ModelNode, reminder: Reminder): void {
  validateReminder(reminder);
  node.types.add(`${c}Reminder`);
  OptionalAs.object(node, `${c}triggerOffset`, reminder.triggerOffset, (v, f) =>
    f.literal(v, f.namedNode(`${NS.XSD}duration`)),
  );
  node.setDate(`${c}triggerTime`, reminder.triggerTime);
}
export function readReminder(node: ModelNode): Reminder {
  const reminder = {
    triggerOffset: node.text(`${c}triggerOffset`),
    triggerTime: node.read(`${c}triggerTime`, LiteralAs.date),
  };
  validateReminder(reminder);
  return reminder;
}
function subject(url: string): string {
  return `${httpIri(url)}#it`;
}
export function buildCalendar(url: string, data: Calendar): Store {
  validateCalendar(data);
  const store = new Store();
  const doc = new CalendarDoc(subject(url), store, DataFactory);
  doc.types.add(CALENDAR_CLASS);
  doc.title = data.title;
  doc.color = data.color;
  return store;
}
export function parseCalendar(url: string, dataset: DatasetCore): Calendar | undefined {
  const doc = new CalendarDoc(subject(url), dataset, DataFactory);
  if (!doc.hasType(CALENDAR_CLASS)) return undefined;
  const data = { title: doc.title ?? "", color: doc.color };
  validateCalendar(data);
  return data;
}
export function buildEvent(url: string, data: CalendarEvent): Store {
  validateEvent(data);
  const store = new Store();
  const doc = new EventDoc(subject(url), store, DataFactory);
  doc.types.add(EVENT_CLASS);
  doc.types.add(`${s}Event`);
  doc.name = data.name;
  doc.start = data.start;
  doc.end = data.end;
  doc.location = data.location;
  doc.description = data.description;
  doc.inCalendar = data.inCalendar;
  doc.uid = data.uid;
  if (data.recurrence) writeRule(doc.link(`${c}recurrence`), data.recurrence);
  for (const reminder of data.reminders ?? []) writeReminder(doc.link(`${c}hasReminder`), reminder);
  return store;
}
export function parseEvent(url: string, dataset: DatasetCore): CalendarEvent | undefined {
  const doc = new EventDoc(subject(url), dataset, DataFactory);
  if (!doc.hasType(EVENT_CLASS) && !doc.hasType(`${s}Event`)) return undefined;
  const start = doc.start;
  if (start === undefined) return undefined;
  const rule = doc.nodes(`${c}recurrence`)[0];
  const data: CalendarEvent = {
    name: doc.name ?? "",
    start,
    end: doc.end,
    location: doc.location,
    description: doc.description,
    inCalendar: doc.inCalendar,
    uid: doc.uid,
    recurrence: rule && readRule(rule),
    reminders: doc.nodes(`${c}hasReminder`).map(readReminder),
  };
  validateEvent(data);
  return data;
}
export function serializeDataset(dataset: DatasetCore): Promise<string> {
  return serialize([...dataset], {
    prefixes: { schema: s, sched: c, xsd: NS.XSD, dct: NS.DCT, solid: NS.SOLID },
  });
}
export function deserializeDataset(text: string, url: string): Promise<DatasetCore> {
  return parseRdf(text, "text/turtle", { baseIRI: url });
}
