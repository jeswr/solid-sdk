// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { copyDataset } from "../core/incremental.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES } from "../core/vocab.js";
import {
  type GCalEvent,
  type GCalEventDateTime,
  type GCalEventsList,
  GOOGLE_CALENDAR_FIXTURES,
} from "./fixtures.js";
import { calendarDate, parseRecurrence } from "./recurrence.js";
import { GoogleCalendarEvent, RecurrenceRule, vocabMap } from "./vocab-map.js";

const ID = "google-calendar";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const SLUG = "calendar/events.ttl";
const SCHEMA = "https://schema.org/";

/** Primary-calendar importer: paginated snapshots, incremental changes and expired-token resync. */
export const googleCalendarAdapter: IntegrationAdapter = {
  vocabMap,
  metadata: {
    id: ID,
    name: "Google Calendar",
    tier: "B",
    authKind: "oauth-pkce",
    scopes: GOOGLE_SCOPES.calendar,
    categories: ["calendar"],
    whatYouGet: "Your events and appointments, saved into Calendar.",
    requirements: [
      "Google OAuth verification: the calendar read scope is sensitive; configure test users until the app is approved.",
      "Browser hosts inject a Web OAuth client id and token proxy URL (TOKEN_PROXY); register their OAuth callback URI.",
      "Node hosts inject a Desktop OAuth client configuration and use loopback PKCE.",
    ],
  },
  oauth: createGoogleOAuthConfig("calendar"),
  fixtures: () => GOOGLE_CALENDAR_FIXTURES,

  async import(ctx: ImportContext): Promise<ImportOutcome> {
    ctx.progress({ label: "Fetching your calendar events…", done: 0 });
    // A lost local snapshot cannot safely consume a delta, even with a host-owned token.
    const existing = await ctx.read(SLUG);
    let syncToken = existing ? ctx.cursor : undefined;
    let batch: Awaited<ReturnType<typeof fetchEvents>>;
    try {
      batch = await fetchEvents(ctx, syncToken);
    } catch (error) {
      if (!syncToken || !(error instanceof IntegrationSyncError) || error.status !== 410)
        throw error;
      // Discard every partial delta page, then retry exactly once without either token.
      syncToken = undefined;
      batch = await fetchEvents(ctx);
    }
    const doc = ctx.resolve(SLUG);
    const events = syncToken ? copyDataset(existing) : new Store();
    let skipped = 0;
    for (const item of batch.items) {
      if (!item || typeof item.id !== "string" || !item.id) {
        skipped++;
        continue;
      }
      const iri = eventIri(doc, item.id);
      if (item.status === "cancelled") {
        removeEvent(events, iri);
        if (item.recurringEventId && item.originalStartTime) {
          const exception = new GoogleCalendarEvent(iri, events, DataFactory);
          exception.types.add(CLASSES.Event);
          exception.identifier = item.id;
          exception.sourceUrl = item.htmlLink ?? `${API}/${encodeURIComponent(item.id)}`;
          exception.parent = eventIri(doc, item.recurringEventId);
          exception.originalStart = eventDate(item.originalStartTime);
          exception.cancelled = true;
        } else {
          // A deleted series also removes any previously imported overridden instances.
          for (const q of [
            ...events.match(
              null,
              DataFactory.namedNode(`${SCHEMA}superEvent`),
              DataFactory.namedNode(iri),
            ),
          ])
            removeEvent(events, q.subject.value);
        }
        continue;
      }
      if (!item.start || !item.end) {
        skipped++;
        continue;
      }
      const start = eventDate(item.start);
      const end = eventDate(item.end);
      if (!start || !end) {
        skipped++;
        continue;
      }
      // Validate recurrence before touching the previous item in the working copy.
      const rules = parseRecurrence(item.recurrence ?? [], item.start.timeZone);
      removeEvent(events, iri);
      const event = new GoogleCalendarEvent(iri, events, DataFactory).mark();
      event.identifier = item.id;
      event.summary = item.summary ?? "(no title)";
      event.details = item.description || undefined;
      event.location = item.location || undefined;
      event.sourceUrl = item.htmlLink ?? `${API}/${encodeURIComponent(item.id)}`;
      event.start = start;
      event.end = end;
      if (item.created) event.dateCreated = validDate(item.created);
      if (item.updated) event.dateModified = validDate(item.updated);
      if (item.recurringEventId) {
        event.parent = eventIri(doc, item.recurringEventId);
        event.originalStart = item.originalStartTime
          ? eventDate(item.originalStartTime)
          : undefined;
      }
      for (const [index, rule] of rules.entries()) {
        const ruleIri = `${iri}/recurrence-${index}`;
        event.recurrence.add(ruleIri);
        event.schedules.add(ruleIri);
        const recurrence = new RecurrenceRule(ruleIri, events, DataFactory);
        recurrence.setRule(rule);
        recurrence.timezone = item.start.timeZone;
      }
    }
    addInstanceExceptions(events);
    await ctx.write({
      slug: SLUG,
      category: "calendar",
      forClass: CLASSES.Event,
      dataset: events,
      writeMode: "replace",
      sourceUrl: API,
    });
    ctx.progress({ label: "Done", done: batch.items.length, total: batch.items.length });
    return { cursor: batch.cursor, skipped: skipped || undefined };
  },
};

async function fetchEvents(
  ctx: ImportContext,
  syncToken?: string,
): Promise<{ items: GCalEvent[]; cursor: string }> {
  const items: GCalEvent[] = [];
  const pages = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL(API);
    url.searchParams.set("singleEvents", "false");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "250");
    if (syncToken) url.searchParams.set("syncToken", syncToken);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const list = await getJson<GCalEventsList>(ID, ctx.api, url.href);
    if (!list || (list.items !== undefined && !Array.isArray(list.items))) invalidPage();
    items.push(...(list.items ?? []));
    pageToken = list.nextPageToken;
    if (
      pageToken !== undefined &&
      (typeof pageToken !== "string" || !pageToken || pages.has(pageToken))
    )
      invalidPage();
    if (pageToken) pages.add(pageToken);
    else {
      if (typeof list.nextSyncToken !== "string" || !list.nextSyncToken) invalidPage();
      return { items, cursor: list.nextSyncToken };
    }
  } while (pageToken);
  return invalidPage();
}

function invalidPage(): never {
  throw new IntegrationSyncError(ID, "Incomplete Calendar response; checkpoint unchanged.");
}

function eventIri(doc: string, id: string): string {
  return `${doc}#event-${encodeURIComponent(id)}`;
}

function eventDate(value: GCalEventDateTime): string | undefined {
  const date = value.date ?? value.dateTime;
  return date ? calendarDate(date) : undefined;
}

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function removeEvent(dataset: Store, iri: string): void {
  for (const q of [...dataset]) {
    if (
      q.subject.termType === "NamedNode" &&
      (q.subject.value === iri || q.subject.value.startsWith(`${iri}/`))
    )
      dataset.delete(q);
  }
}

// Retain cancelled and moved instance identities so later master updates keep their exceptions.
function addInstanceExceptions(dataset: DatasetCore): void {
  for (const q of dataset.match(null, DataFactory.namedNode(`${SCHEMA}superEvent`), null)) {
    if (q.subject.termType !== "NamedNode" || q.object.termType !== "NamedNode") continue;
    const original = [
      ...dataset.match(q.subject, DataFactory.namedNode(`${SCHEMA}previousStartDate`), null),
    ][0]?.object;
    if (original?.termType !== "Literal") continue;
    const parent = new GoogleCalendarEvent(q.object.value, dataset, DataFactory);
    for (const iri of parent.recurrence)
      new RecurrenceRule(iri, dataset, DataFactory).exceptions.add(original.value);
  }
}
