// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { checkOwnerOnly } from "@jeswr/pod-access";
import { setGrants } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  parseReservations,
  parseTrip,
  SCHEMA,
  serializeReservation,
  serializeTrip,
} from "./model.js";
import { groupIntoTrips } from "./planning.js";
import { tripsTypeIndex } from "./type-index.js";
import {
  type ExtractMarkup,
  type ReadNotice,
  type Reservation,
  type ReservationInput,
  reservationKinds,
  type Trip,
  type TripSnapshot,
} from "./types.js";

export interface StorePorts {
  storage: StorageClient;
  index: Pick<TypeIndex, "findAll" | "register">;
  /** Establish and verify owner-only resource and descendant access. */
  protect(url: string, folder: boolean): Promise<void>;
  verifyPrivateIndex?(): Promise<void>;
}
const documentOf = (id: string) => id.split("#")[0] as string;
export function createTripsStore(ports: StorePorts) {
  const { storage, index, protect } = ports;
  let base = new URL("trips/", storage.root).href;
  let manual = new URL("reservations/", base).href;
  // Conditional cleanup cannot delete another writer's intervening update.
  async function cleanup(url: string, etag: string | null | undefined) {
    if (!etag) return;
    try {
      await storage.delete(url, { ifMatch: etag });
    } catch {
      /* Best effort; preserve the original failure. */
    }
  }
  async function folder(parent: string, name: string) {
    const expected = new URL(`${name}/`, parent).href;
    let url = expected;
    let created: Awaited<ReturnType<StorageClient["create"]>> | undefined;
    try {
      await storage.head(expected);
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      created = await storage.create(parent, null, { name, kind: "container" });
      url = assertWithinPodScope(parent, created.url, { allowRoot: false });
    }
    try {
      await protect(url, true);
    } catch (error) {
      if (created?.etagSource === "response") await cleanup(url, created.etag);
      throw error;
    }
    return url;
  }
  async function initialise() {
    base = await folder(storage.root, "trips");
    manual = await folder(base, "reservations");
    await ports.verifyPrivateIndex?.();
    await index.register(`${SCHEMA}Trip`, { container: base }, { index: "private" });
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
  /** Own containers page to completion; connector scans have explicit budgets. */
  async function documents(
    container: string,
    notice: ReadNotice,
    signal?: AbortSignal,
    cap = Infinity,
  ) {
    const urls = new Set<string>();
    let cursor: import("@jeswr/storage-client").PageCursor | undefined;
    const visited = new Set<string>();
    let pages = 0;
    do {
      try {
        signal?.throwIfAborted();
        const page = await storage.list(container, { cursor, signal, maxBytes: 1024 * 1024 });
        for (const entry of page.items) {
          if (entry.kind === "container") continue;
          try {
            const url = assertWithinPodScope(container, entry.url, { allowRoot: false });
            if (!urls.has(url) && urls.size >= cap) {
              notice.capped = true;
              notice.skipped++;
              return [...urls];
            }
            urls.add(url);
          } catch {
            notice.skipped++;
          }
        }
        cursor = page.next ?? undefined;
        if (cursor && (visited.has(cursor.url) || (++pages >= 8 && cap !== Infinity))) {
          notice.capped = true;
          notice.skipped++;
          break;
        }
        if (cursor) visited.add(cursor.url);
      } catch {
        notice.skipped++;
        notice.capped ||= signal?.aborted ?? false;
        break;
      }
    } while (cursor);
    return [...urls];
  }
  async function load(): Promise<TripSnapshot> {
    const trips: Trip[] = [],
      reservations: Reservation[] = [];
    const notice: ReadNotice = { skipped: 0, capped: false };
    const docs = new Set(await documents(manual, notice));
    for (const url of await documents(base, notice)) {
      try {
        const { dataset, etag } = await read(url);
        const trip = parseTrip(`${url}#it`, dataset);
        if (trip) {
          trips.push({ ...trip, etag });
          for (const id of trip.reservations) docs.add(documentOf(id));
        } else notice.skipped++;
      } catch {
        notice.skipped++;
      }
    }
    for (const url of docs) {
      try {
        const parsed = parseReservations((await read(url)).dataset, url);
        reservations.push(...parsed);
        if (!parsed.length) notice.skipped++;
      } catch {
        notice.skipped++;
      }
    }
    return { trips, reservations, notice };
  }
  async function saveTrip(trip: Trip): Promise<Trip> {
    if (trip.etag === null) throw new Error("A version is required to edit this trip safely");
    const creating = !trip.etag;
    const created = creating
      ? await storage.create(base, null, { contentType: "text/turtle" })
      : undefined;
    const url = assertWithinPodScope(base, created?.url ?? documentOf(trip.id), {
      allowRoot: false,
    });
    let cleanupTag = created?.etagSource === "response" ? created.etag : null;
    try {
      if (creating) await protect(url, false);
      const original = await storage.read(url);
      if (creating && (await original.bytes()).length)
        throw new Error("New trip is no longer empty");
      if (creating) cleanupTag = original.etag;
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
    } catch (error) {
      if (creating) await cleanup(url, cleanupTag);
      throw error;
    }
  }
  async function addReservation(input: ReservationInput): Promise<Reservation> {
    const created = await storage.create(manual, null, { contentType: "text/turtle" });
    const url = assertWithinPodScope(manual, created.url, { allowRoot: false });
    let cleanupTag = created.etagSource === "response" ? created.etag : null;
    try {
      await protect(url, false);
      const fresh = await storage.read(url);
      if ((await fresh.bytes()).length) throw new Error("New booking is no longer empty");
      cleanupTag = fresh.etag;
      if (!fresh.etag) throw new Error("A version is required to save safely");
      const result = await storage.write(url, await serializeReservation(url, input), {
        contentType: "text/turtle",
        ifMatch: fresh.etag,
      });
      // Only response validators can authorise later compensation (follow-up HEADs can race).
      return {
        ...input,
        id: `${url}#it`,
        etag: result.etagSource === "response" ? result.etag : null,
      };
    } catch (error) {
      await cleanup(url, cleanupTag);
      throw error;
    }
  }
  async function deleteReservation(reservation: Reservation) {
    const url = assertWithinPodScope(manual, documentOf(reservation.id), { allowRoot: false });
    if (!reservation.etag) throw new Error("A version is required to remove a booking safely");
    await storage.delete(url, { ifMatch: reservation.etag });
  }
  async function scan(existing: Trip[], known: Reservation[] = []) {
    const signal = AbortSignal.timeout(30000);
    signal.throwIfAborted();
    const found = await index.findAll(reservationKinds.map((kind) => SCHEMA + kind));
    const sources = new Set(reservationKinds.flatMap((kind) => found.get(SCHEMA + kind) ?? []));
    const notice: ReadNotice = {
      skipped: Math.max(0, sources.size - 16),
      capped: sources.size > 16,
    };
    const results: Reservation[] = [],
      docs = new Set<string>();
    for (const source of [...sources].slice(0, 16)) {
      try {
        signal.throwIfAborted();
        const scoped = assertWithinPodScope(storage.root, source);
        const urls = scoped.endsWith("/")
          ? await documents(scoped, notice, signal, 200)
          : [documentOf(scoped)];
        for (const url of urls) {
          if (!docs.has(url) && docs.size >= 200) {
            notice.capped = true;
            notice.skipped++;
            continue;
          }
          docs.add(url);
        }
      } catch {
        notice.skipped++;
        notice.capped ||= signal.aborted;
      }
    }
    for (const url of docs) {
      try {
        signal.throwIfAborted();
        const parsed = parseReservations((await read(url, signal)).dataset, url);
        const remaining = 200 - results.length;
        results.push(...parsed.slice(0, remaining));
        if (parsed.length > remaining) {
          notice.capped = true;
          notice.skipped++;
        }
      } catch {
        notice.skipped++;
        notice.capped ||= signal.aborted;
      }
    }
    // A scanned document cannot replace a manual record with the same claimed subject.
    const reservations = [
      ...new Map([...results, ...known].map((item) => [item.id, item])).values(),
    ];
    return {
      reservations,
      suggestions: groupIntoTrips(reservations, existing),
      sources: sources.size,
      notice,
    };
  }
  return {
    initialise,
    load,
    saveTrip,
    addReservation,
    deleteReservation,
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
  const storage = demo
    ? createSolidBackend({ fetch, root })
    : (await createPodClient({ fetch, storage: root })).storage;
  const { index, verifyPrivateIndex } = tripsTypeIndex(storage, fetch, owner, demo);
  return createTripsStore({
    storage,
    index,
    verifyPrivateIndex,
    protect: async (url, folder) => {
      if (demo) return; // Explicit session fixture, never inferred from RDF.
      const result = await setGrants(
        [url],
        [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
        { fetch, webId: owner, root, kind: folder ? "folder" : "resource", ownOnly: true },
      );
      if (result.failed.length) throw new Error("Could not establish owner-only Trips storage");
      if (!(await checkOwnerOnly({ storage, url, ownerWebId: owner })).private)
        throw new Error("Could not verify owner-only Trips storage");
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
