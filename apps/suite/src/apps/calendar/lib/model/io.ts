// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import {
  buildCalendar,
  buildEvent,
  CALENDAR_CLASS,
  EVENT_CLASS,
  ModelNode,
  parseCalendar,
  parseEvent,
  serializeDataset,
} from "./rdf";
import { expandEvent } from "./recurrence";
import type { Calendar, CalendarEvent, StoredItem } from "./types";

export class CalendarHttpError extends Error {
  constructor(
    readonly status: number,
    readonly etag: string | null,
  ) {
    super(`Calendar request failed (${status})`);
  }
}
/** Explicit scope + fetch; no authentication or ambient global fetch assumptions. */
export function calendarIO(fetch: typeof globalThis.fetch, podRoot: string) {
  const scoped = createPodScopedFetch(podRoot, { fetch });
  function document(url: string): string {
    assertWithinPodScope(podRoot, url, { allowRoot: false });
    const u = new URL(url);
    if (u.hash || u.search || u.pathname.endsWith("/"))
      throw new TypeError("Expected resource document URL");
    return u.href;
  }
  async function load<T>(
    url: string,
    parse: (url: string, ds: DatasetCore) => T | undefined,
  ): Promise<StoredItem<T> | undefined> {
    const { dataset, etag } = await fetchRdf(document(url), {
      fetch: scoped,
      headers: { "Cache-Control": "no-cache" },
    });
    const data = parse(url, dataset);
    return data === undefined ? undefined : { url, etag, data };
  }
  async function put(
    url: string,
    dataset: DatasetCore,
    precondition: { create: true } | { etag: string },
  ): Promise<string | null> {
    document(url);
    const headers = new Headers({ "Content-Type": "text/turtle" });
    if ("create" in precondition) headers.set("If-None-Match", "*");
    else {
      if (!precondition.etag || precondition.etag === "*" || precondition.etag.startsWith("W/"))
        throw new TypeError("A strong ETag is required");
      headers.set("If-Match", precondition.etag);
    }
    const response = await scoped(url, {
      method: "PUT",
      headers,
      body: await serializeDataset(dataset),
    });
    if (!response.ok) throw new CalendarHttpError(response.status, response.headers.get("etag"));
    return response.headers.get("etag");
  }
  async function listResources(containerUrl: string): Promise<string[]> {
    const { dataset } = await fetchRdf(containerUrl, { fetch: scoped });
    const container = new ContainerDataset(dataset, DataFactory).container;
    return [...(container?.contains ?? [])]
      .map((r) => r.id)
      .filter((url) => {
        assertWithinPodScope(containerUrl, url, { allowRoot: false });
        return !new URL(url).pathname.endsWith("/");
      });
  }
  return {
    loadCalendar: (url: string) => load(url, parseCalendar),
    loadEvent: (url: string) => load(url, parseEvent),
    saveCalendar: (
      url: string,
      data: Calendar,
      precondition: { create: true } | { etag: string },
    ) => put(url, buildCalendar(url, data), precondition),
    saveEvent: (
      url: string,
      data: CalendarEvent,
      precondition: { create: true } | { etag: string },
    ) => put(url, buildEvent(url, data), precondition),
    listResources,
    async eventsInRange(
      containerUrl: string,
      from: Date,
      to: Date,
      timeZone = "UTC",
    ): Promise<StoredItem<CalendarEvent>[]> {
      const events: StoredItem<CalendarEvent>[] = [];
      for (const url of await listResources(containerUrl)) {
        const item = await load(url, parseEvent);
        if (item)
          for (const data of expandEvent(item.data, from, to, timeZone))
            events.push({ ...item, data });
      }
      return events.sort((a, b) => +new Date(a.data.start) - +new Date(b.data.start));
    },
    async removeEvent(url: string, etag: string): Promise<void> {
      document(url);
      if (!etag || etag === "*" || etag.startsWith("W/"))
        throw new TypeError("A strong ETag is required");
      const response = await scoped(url, { method: "DELETE", headers: { "If-Match": etag } });
      if (!response.ok) throw new CalendarHttpError(response.status, response.headers.get("etag"));
    },
    /** Register into an existing caller-selected index; preserve unrelated data and legacy aliases. */
    async registerCalendar(
      indexUrl: string,
      calendarUrl: string,
      eventContainer: string,
    ): Promise<number> {
      document(indexUrl);
      document(calendarUrl);
      assertWithinPodScope(podRoot, eventContainer);
      const { dataset, etag } = await fetchRdf(indexUrl, {
        fetch: scoped,
        headers: { "Cache-Control": "no-cache" },
      });
      const subjects = [
        ...dataset.match(
          null,
          DataFactory.namedNode(`${NS.RDF}type`),
          DataFactory.namedNode(`${NS.SOLID}TypeRegistration`),
        ),
      ].map((q) => new ModelNode(q.subject, dataset, DataFactory));
      let added = 0;
      for (const [type, predicate, target] of [
        [CALENDAR_CLASS, "instance", `${calendarUrl}#it`],
        [EVENT_CLASS, "instanceContainer", eventContainer],
      ]) {
        if (
          subjects.some(
            (node) =>
              canonicalize(node.iri(`${NS.SOLID}forClass`) ?? "") === type &&
              node.iri(NS.SOLID + predicate) === target,
          )
        )
          continue;
        const node = new ModelNode(DataFactory.blankNode(), dataset, DataFactory);
        node.types.add(`${NS.SOLID}TypeRegistration`);
        node.setIri(`${NS.SOLID}forClass`, type);
        node.setIri(NS.SOLID + predicate, target);
        added++;
      }
      if (added) {
        if (!etag) throw new TypeError("A strong ETag is required");
        await put(indexUrl, dataset, { etag });
      }
      return added;
    },
  };
}
