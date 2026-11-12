// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch, podScopedUrl, refuseRedirects } from "@jeswr/guarded-fetch";
import { termsEqual } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import {
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
} from "../../docs/lib/model/type-index";
import { CALENDAR_CLASS, type CalendarEvent, CalendarHttpError, calendarIO } from "../lib/model";
import { type CalendarInfo, calendarColour, type Occurrence } from "./view";

export interface CalendarAccount {
  webId: string;
  storageUrl: string;
  fetch: typeof globalThis.fetch;
  /** Pristine public transport, never an authenticated session fetch. */
  publicFetch?: typeof globalThis.fetch;
}
// Capture before sign-in can patch the global. Foreign profile reads omit cookies and refuse redirects.
const publicFetch = globalThis.fetch.bind(globalThis);
export interface CalendarWarning {
  calendarUrl: string;
  title: string;
  error: unknown;
}
export function calendarDocument(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  return parsed.href;
}
export function eventContainer(url: string): string {
  return `${calendarDocument(url).replace(/\.ttl$/, "")}/`;
}
export function calendarSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new TypeError("Enter a calendar name containing letters or numbers");
  return slug;
}
/** Public profile GETs are the only requests allowed outside storage. */
function calendarFetch(account: CalendarAccount): typeof globalThis.fetch {
  const fetch = createPodScopedFetch(account.storageUrl, { fetch: account.fetch });
  const profileUrl = calendarDocument(account.webId);
  const profileFetch = refuseRedirects((input, init) =>
    (account.publicFetch ?? publicFetch)(input, { ...init, credentials: "omit" }),
  );
  return (input, init) => {
    const request = new Request(input, init);
    return request.method === "GET" &&
      calendarDocument(request.url) === profileUrl &&
      !podScopedUrl(account.storageUrl, profileUrl)
      ? profileFetch(profileUrl, init)
      : fetch(input, init);
  };
}
export async function discoverCalendars(
  account: CalendarAccount,
): Promise<{ calendars: CalendarInfo[]; warnings: CalendarWarning[] }> {
  const fetch = createPodScopedFetch(account.storageUrl, { fetch: account.fetch });
  const io = calendarIO(account.fetch, account.storageUrl);
  const profileUrl = calendarDocument(account.webId);
  const { dataset } = await fetchRdf(profileUrl, { fetch: calendarFetch(account) });
  const anchor = new ProfileTypeIndexAnchor(account.webId, dataset, DataFactory);
  const indexes = new Set(anchor.privateIndexes);
  for (const prefs of anchor.preferencesFiles) {
    const { dataset: preferences } = await fetchRdf(prefs, { fetch });
    for (const index of new ProfileTypeIndexAnchor(account.webId, preferences, DataFactory)
      .privateIndexes)
      indexes.add(index);
  }
  const urls = new Set<string>();
  for (const index of indexes) {
    try {
      const { dataset: graph } = await fetchRdf(index, { fetch });
      for (const location of new TypeIndexDataset(graph, DataFactory).all()) {
        if (!termsEqual(location.forClass, CALENDAR_CLASS)) continue;
        if (location.instance && podScopedUrl(account.storageUrl, location.instance)) {
          urls.add(calendarDocument(location.instance));
        }
        if (location.container && podScopedUrl(account.storageUrl, location.container)) {
          for (const url of await io.listResources(location.container)) urls.add(url);
        }
      }
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    }
  }
  try {
    for (const url of await io.listResources(new URL("calendar/", account.storageUrl).href)) {
      if (url.endsWith(".ttl")) {
        urls.add(url);
      }
    }
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
  }
  const calendars: CalendarInfo[] = [];
  const warnings: CalendarWarning[] = [];
  for (const url of urls) {
    try {
      const item = await io.loadCalendar(url);
      if (item)
        calendars.push({
          url: item.url,
          title: item.data.title,
          colour: calendarColour(url, item.data.color),
          etag: item.etag,
          container: eventContainer(item.url),
        });
    } catch (error) {
      warnings.push({ calendarUrl: url, title: "A calendar could not be loaded", error });
    }
  }
  return { calendars, warnings };
}
// Only resume resources created by this account's own incomplete attempt.
const creations = new WeakMap<CalendarAccount, Set<string>>();
export async function createCalendar(
  account: CalendarAccount,
  title: string,
  colour: string,
): Promise<void> {
  const io = calendarIO(account.fetch, account.storageUrl);
  const url = new URL(`calendar/${calendarSlug(title)}.ttl`, account.storageUrl).href;
  const container = eventContainer(url);
  let attempts = creations.get(account);
  if (!attempts) {
    attempts = new Set();
    creations.set(account, attempts);
  }
  const attempt = JSON.stringify([url, title.trim(), colour]);
  if (!attempts.has(attempt)) {
    await io.saveCalendar(url, { title: title.trim(), color: colour }, { create: true });
    attempts.add(attempt);
  }
  // An empty LDP BasicContainer is represented by the request Link header, no invented RDF.
  const response = await createPodScopedFetch(account.storageUrl, { fetch: account.fetch })(
    container,
    {
      method: "PUT",
      headers: {
        "If-None-Match": "*",
        "Content-Type": "text/turtle",
        Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
      body: "",
    },
  );
  if (!response.ok && response.status !== 412)
    throw new CalendarHttpError(response.status, response.headers.get("etag"));
  const { indexUrl } = await ensureTypeRegistrations({
    webId: account.webId,
    podRoot: account.storageUrl,
    registrations: [],
    fetchImpl: calendarFetch(account),
  });
  await io.registerCalendar(indexUrl, url, container);
  attempts.delete(attempt);
}
/** Range order: by start, then by URL so ties are stable. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return +new Date(a.data.start) - +new Date(b.data.start) || a.url.localeCompare(b.url);
}
export async function loadRange(
  account: CalendarAccount,
  calendars: CalendarInfo[],
  from: Date,
  to: Date,
  timeZone: string,
): Promise<{ events: Occurrence[]; warnings: CalendarWarning[] }> {
  const io = calendarIO(account.fetch, account.storageUrl);
  const events: Occurrence[] = [];
  const warnings: CalendarWarning[] = [];
  await Promise.all(
    calendars.map(async (calendar) => {
      try {
        // eventsInRange expands each series exactly once with expandEvent, retaining source identity/ETag.
        for (const item of await io.eventsInRange(calendar.container, from, to, timeZone))
          events.push({ ...item, id: JSON.stringify([item.url, item.data.start]), calendar });
      } catch (error) {
        warnings.push({
          calendarUrl: calendar.url,
          title: `Could not load events from ${calendar.title}`,
          error,
        });
      }
    }),
  );
  events.sort(compareOccurrences);
  return { events, warnings };
}
export type EventWrite = (
  | { kind: "create"; url: string; data: CalendarEvent }
  | { kind: "update"; url: string; data: CalendarEvent; etag: string }
  | { kind: "delete"; url: string; etag: string }
) & { confirmation?: { etag: string | null } };
/** Serial per resource; each queued intent remains visible when an older write fails. */
export function eventMutations(
  account: CalendarAccount,
  changed: (writes: EventWrite[]) => void,
  invalidate: () => void,
  failed: (error: unknown, conflict: boolean) => void,
) {
  const pending = new Map<number, EventWrite>();
  // A range acknowledges these by identity only after its own revalidation finishes.
  const confirmed = new Map<string, EventWrite>();
  const publish = () => changed([...confirmed.values(), ...pending.values()]);
  const tails = new Map<string, Promise<unknown>>();
  const etags = new Map<string, string>();
  const conflicts = new Map<string, number>();
  let next = 0;
  return async (write: EventWrite, fetch = account.fetch): Promise<string | null> => {
    const io = calendarIO(fetch, account.storageUrl);
    const id = ++next;
    pending.set(id, write);
    publish();
    const queued = tails.has(write.url);
    const conflictVersion = conflicts.get(write.url) ?? 0;
    const prior = tails.get(write.url) ?? Promise.resolve();
    const task = prior.then(async () => {
      const etag = queued ? etags.get(write.url) : undefined;
      try {
        if ((conflicts.get(write.url) ?? 0) !== conflictVersion)
          throw new CalendarHttpError(412, null);
        let savedEtag: string | null = null;
        if (write.kind === "delete") {
          await io.removeEvent(write.url, etag ?? write.etag);
          etags.delete(write.url);
        } else {
          const saved = await io.saveEvent(
            write.url,
            write.data,
            write.kind === "create" ? { create: true } : { etag: etag ?? write.etag },
          );
          savedEtag = saved;
          if (saved) etags.set(write.url, saved);
          else etags.delete(write.url);
        }
        confirmed.set(write.url, { ...write, confirmation: { etag: savedEtag } });
        return savedEtag;
      } catch (error) {
        const conflict = error instanceof CalendarHttpError && error.status === 412;
        if (conflict) {
          confirmed.delete(write.url);
          etags.delete(write.url);
          // Fetch the changed master; never replay a stale resource after a conflict.
          conflicts.set(write.url, conflictVersion + 1);
          await io.loadEvent(write.url).catch(() => undefined);
        }
        failed(error, conflict);
        throw error;
      } finally {
        pending.delete(id);
        publish();
        invalidate();
      }
    });
    const settled = task.catch(() => undefined);
    tails.set(write.url, settled);
    try {
      return await task;
    } finally {
      if (tails.get(write.url) === settled) tails.delete(write.url);
    }
  };
}
