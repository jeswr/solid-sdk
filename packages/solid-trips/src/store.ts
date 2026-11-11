// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { readGrants, setGrants } from "@jeswr/pod-access/roles";
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import {
  parseReservations,
  parseTrip,
  SCHEMA,
  serializeReservation,
  serializeTrip,
} from "./model.js";
import { groupIntoTrips } from "./planning.js";
import {
  type ExtractMarkup,
  type Reservation,
  type ReservationInput,
  reservationKinds,
  type Trip,
  type TripSnapshot,
} from "./types.js";

/** The connector owns the path below each registered mail account. Never crawl messages. */
export const MAIL_RESERVATIONS_PATH = "trips/";
export interface StorePorts {
  storage: StorageClient;
  index: Pick<TypeIndex, "findAll" | "register">;
  /** Must resolve only after owner-only resource + descendant access is established. */
  protect(url: string, folder: boolean): Promise<void>;
  privateDocuments?(): Promise<string[]>;
}
const documentOf = (id: string) => id.split("#")[0] as string;
export function createTripsStore(ports: StorePorts) {
  const { storage, index, protect } = ports;
  let base = new URL("trips/", storage.root).href;
  let manual = new URL("reservations/", base).href;
  async function folder(parent: string, name: string) {
    const expected = new URL(`${name}/`, parent).href;
    let url = expected;
    try {
      await storage.head(expected);
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      url = (await storage.create(parent, null, { name, kind: "container" })).url;
    }
    await protect(url, true);
    return url;
  }
  async function initialise() {
    base = await folder(storage.root, "trips");
    manual = await folder(base, "reservations");
    const settings = await folder(storage.root, "settings");
    for (const file of ["prefs.ttl", "privateTypeIndex.ttl"]) {
      const url = new URL(file, settings).href;
      try {
        await storage.head(url);
        await protect(url, false);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      }
    }
    for (const url of (await ports.privateDocuments?.()) ?? []) await protect(url, false);
    await index.register(`${SCHEMA}Trip`, { container: base }, { index: "private" });
    for (const url of (await ports.privateDocuments?.()) ?? []) await protect(url, false);
  }
  async function read(url: string, signal?: AbortSignal) {
    const scoped = assertWithinPodScope(storage.root, documentOf(url));
    const response = await storage.read(scoped, {
      signal,
      accept: "text/turtle, application/ld+json;q=0.9",
    });
    const dataset = await parseRdf(response.body ?? "", response.contentType, {
      baseIRI: scoped,
      maxBytes: 512 * 1024,
      maxQuads: 10000,
      signal,
    });
    return { dataset, etag: response.etag };
  }
  async function documents(container: string, signal?: AbortSignal) {
    const urls: string[] = [];
    let cursor: import("@jeswr/storage-client").PageCursor | undefined;
    let pages = 0;
    do {
      const page = await storage.list(container, { cursor, signal, maxBytes: 1024 * 1024 });
      for (const entry of page.items)
        if (entry.kind !== "container") {
          urls.push(assertWithinPodScope(container, entry.url, { allowRoot: false }));
          if (urls.length > 200) throw new Error("More than 200 documents; narrow the source");
        }
      cursor = page.next ?? undefined;
      if (++pages >= 8 && cursor) throw new Error("More than eight pages; narrow the source");
    } while (cursor);
    return urls;
  }
  async function load(): Promise<TripSnapshot> {
    const trips: Trip[] = [];
    const reservations: Reservation[] = [];
    const docs = new Set(await documents(manual));
    for (const url of await documents(base)) {
      const { dataset, etag } = await read(url);
      const trip = parseTrip(`${url}#it`, dataset);
      if (trip) {
        trips.push({ ...trip, etag });
        for (const id of trip.reservations) docs.add(documentOf(id));
      }
    }
    if (docs.size > 200) throw new Error("Too many linked reservations");
    for (const url of docs) {
      try {
        reservations.push(...parseReservations((await read(url)).dataset));
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      }
    }
    return { trips, reservations };
  }
  async function saveTrip(trip: Trip): Promise<Trip> {
    if (trip.etag === null) throw new Error("A version is required to edit this trip safely");
    const creating = !trip.etag;
    const url = creating
      ? (await storage.create(base, null, { contentType: "text/turtle" })).url
      : assertWithinPodScope(base, documentOf(trip.id), { allowRoot: false });
    if (creating) await protect(url, false);
    const original = await storage.read(url);
    if (creating && (await original.bytes()).length) throw new Error("New trip is no longer empty");
    const etag = creating ? original.etag : trip.etag;
    if (!etag) throw new Error("A version is required to save safely");
    const saved = {
      ...trip,
      id: `${url}#it`,
      modified: new Date().toISOString(),
      created: trip.created ?? new Date().toISOString(),
    };
    const result = await storage.write(url, await serializeTrip(saved), {
      contentType: "text/turtle",
      ifMatch: etag,
    });
    return { ...saved, etag: result.etag };
  }
  async function addReservation(input: ReservationInput): Promise<Reservation> {
    const created = await storage.create(manual, null, { contentType: "text/turtle" });
    await protect(created.url, false);
    const fresh = await storage.read(created.url);
    if (!fresh.etag || (await fresh.bytes()).length)
      throw new Error("New booking is no longer empty");
    await storage.write(created.url, await serializeReservation(created.url, input), {
      contentType: "text/turtle",
      ifMatch: fresh.etag,
    });
    return { ...input, id: `${created.url}#it` };
  }
  async function scan(existing: Trip[], known: Reservation[] = []) {
    const signal = AbortSignal.timeout(30000);
    const found = await index.findAll([
      ...reservationKinds.map((kind) => SCHEMA + kind),
      `${SCHEMA}EmailMessage`,
    ]);
    const sources = new Set(reservationKinds.flatMap((kind) => found.get(SCHEMA + kind) ?? []));
    for (const account of found.get(`${SCHEMA}EmailMessage`) ?? [])
      if (account.endsWith("/")) sources.add(new URL(MAIL_RESERVATIONS_PATH, account).href);
    if (sources.size > 16) throw new Error("More than 16 sources; narrow the scan");
    const results: Reservation[] = [];
    const docs = new Set<string>();
    for (const source of sources) {
      assertWithinPodScope(storage.root, source);
      try {
        for (const url of source.endsWith("/")
          ? await documents(source, signal)
          : [documentOf(source)])
          docs.add(url);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      }
      if (docs.size > 200) throw new Error("More than 200 reservations; narrow the scan");
    }
    for (const url of docs) results.push(...parseReservations((await read(url, signal)).dataset));
    const reservations = [
      ...new Map([...known, ...results].map((item) => [item.id, item])).values(),
    ];
    return {
      reservations,
      suggestions: groupIntoTrips(reservations, existing),
      sources: sources.size,
    };
  }
  return {
    initialise,
    load,
    saveTrip,
    addReservation,
    scan,
    get base() {
      return base;
    },
  };
}
export type TripsStore = ReturnType<typeof createTripsStore>;
export async function openTripsStore(
  fetch: typeof globalThis.fetch,
  root: string,
  owner: string,
  demo = false,
): Promise<TripsStore> {
  // The explicit demo fixture has no storage-description service. Real accounts use discovery.
  const storage = demo
    ? createSolidBackend({ fetch, root })
    : (await createPodClient({ fetch, storage: root })).storage;
  const index = createTypeIndex({
    storage,
    features: storage.features,
    profile: owner,
    fetch,
  });
  return createTripsStore({
    storage,
    index,
    privateDocuments: async () => {
      const profile = await storage.readRdf(owner.split("#")[0] as string);
      const agent = new TermWrapper(owner, profile.dataset, DataFactory);
      const docs = new Set<string>();
      const direct = OptionalFrom.subjectPredicate(
        agent,
        "http://www.w3.org/ns/solid/terms#privateTypeIndex",
        NamedNodeAs.string,
      );
      if (direct) docs.add(assertWithinPodScope(root, direct));
      const preferences = OptionalFrom.subjectPredicate(
        agent,
        "http://www.w3.org/ns/pim/space#preferencesFile",
        NamedNodeAs.string,
      );
      if (preferences) {
        const url = assertWithinPodScope(root, preferences);
        docs.add(url);
        const settings = await storage.readRdf(url);
        const subject = new TermWrapper(owner, settings.dataset, DataFactory);
        const privateIndex = OptionalFrom.subjectPredicate(
          subject,
          "http://www.w3.org/ns/solid/terms#privateTypeIndex",
          NamedNodeAs.string,
        );
        if (privateIndex) docs.add(assertWithinPodScope(root, privateIndex));
      }
      return [...docs];
    },
    protect: async (url, folder) => {
      if (demo) return; // Explicit fixture mode supplied by the authenticated session, never inferred from RDF.
      const result = await setGrants(
        [url],
        [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
        { fetch, webId: owner, root, kind: folder ? "folder" : "resource", ownOnly: true },
      );
      if (result.failed.length) throw new Error("Could not establish owner-only Trips storage");
      const effective = await readGrants(url, {
        fetch,
        root,
        kind: folder ? "folder" : "resource",
      });
      if (
        !effective.grants.some((grant) => grant.role === "manager") ||
        effective.grants.some((grant) => grant.agent.type !== "webid" || grant.agent.id !== owner)
      )
        throw new Error("Trips storage has inherited access for someone else");
    },
  });
}
export async function importEmail(
  html: string,
  extract?: ExtractMarkup,
): Promise<ReservationInput[]> {
  if (!extract) throw new Error("Coming soon: email import needs the mail markup connector");
  if (new TextEncoder().encode(html).length > 1024 * 1024)
    throw new Error("Email is larger than 1 MiB");
  const items = await extract(html);
  if (items.length > 100) throw new Error("More than 100 bookings in one email");
  return items.map((item) => ({ ...item, trust: "unverified" }));
}
