// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
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
import { TypeIndexSetupError, tripsTypeIndex } from "./type-index.js";
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
  /**
   * Owner-only access for a Trips container or document. With `created` (this call just made
   * the resource and has written nothing into it) the port may establish owner-only access
   * and must then verify it. Otherwise it must only verify: it never changes the access of a
   * resource the user already had. Refusals are a {@link TripsPrivacyError}.
   */
  protect(url: string, folder: boolean, created: boolean): Promise<void>;
  verifyPrivateIndex?(): Promise<void>;
  /** Budget for reading the user's own Trips containers; exceeding it gives a partial notice. */
  loadBudget?: { maxPages?: number; timeoutMs?: number };
}
/** Generous defaults: own containers are owner-written, but a server can still page forever. */
export const DEFAULT_LOAD_BUDGET = { maxPages: 100, timeoutMs: 60_000 } as const;
/**
 * Trips will not keep private data in a place it cannot prove is owner-only. `shared` means
 * the folder (pre-existing, so never rewritten) is readable by others or its access could not
 * be verified; `unestablished` means a folder Trips just created could not be made private.
 * Neither changes anyone's sharing.
 */
export class TripsPrivacyError extends Error {
  constructor(
    message: string,
    readonly reason: "shared" | "unestablished" | "unverified",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TripsPrivacyError";
  }
}
/** Type Index registration is discovery metadata: it is retried later and never blocks Trips. */
export type TripsRegistration =
  | { status: "pending" }
  | { status: "registered" }
  | { status: "skipped"; message: string }
  | { status: "failed"; message: string; cause: unknown };
/**
 * The trip write may or may not have committed (network loss, timeout, 5xx, a malformed
 * success). Callers must not compensate as though it failed; reload and check instead.
 */
export class UnconfirmedWriteError extends Error {
  constructor(cause: unknown) {
    super("Could not confirm whether the change reached your pod", { cause });
    this.name = "UnconfirmedWriteError";
  }
}
/** A definite refusal: the request never ran (scope, unsupported) or a 4xx other than 408. */
function definiteRefusal(error: unknown): boolean {
  if (!(error instanceof StorageError)) return false;
  if (error.code === "scope" || error.code === "unsupported") return true;
  return error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408;
}
const documentOf = (id: string) => id.split("#")[0] as string;
export function createTripsStore(ports: StorePorts) {
  const { storage, index, protect } = ports;
  const budget = { ...DEFAULT_LOAD_BUDGET, ...ports.loadBudget };
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
  /** Folders (by URL) that already existed and could not be verified owner-only. */
  const unprivate = new Set<string>();
  let registration: TripsRegistration = { status: "pending" };
  let manualExists = true;
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
      // Only a folder this call created is sealed. A pre-existing one is verified, and when it
      // is not owner-only it is left exactly as the user set it up: private writes refuse.
      await protect(url, true, created !== undefined);
      unprivate.delete(url);
    } catch (error) {
      if (!created && error instanceof TripsPrivacyError) unprivate.add(url);
      else {
        if (created?.etagSource === "response") await cleanup(url, created.etag);
        throw error;
      }
    }
    return url;
  }
  /** Re-verify (never repair) the container immediately before a private write. */
  async function requirePrivate(container: string) {
    await protect(container, true, false);
    // A folder that was shared at open and is private now no longer blocks registration.
    unprivate.delete(container);
  }
  async function register() {
    if (unprivate.has(base)) {
      registration = {
        status: "skipped",
        message: "Your Trips folder is shared, so Trips was not added to your private Type Index.",
      };
      return registration;
    }
    try {
      await ports.verifyPrivateIndex?.();
      await index.register(`${SCHEMA}Trip`, { container: base }, { index: "private" });
      registration = { status: "registered" };
    } catch (cause) {
      registration = {
        status: "failed",
        message:
          cause instanceof TypeIndexSetupError
            ? cause.message
            : "Trips could not be added to your Type Index yet. Your trips are still available; try again later.",
        cause,
      };
    }
    return registration;
  }
  async function initialise() {
    base = await folder(storage.root, "trips");
    manual = new URL("reservations/", base).href;
    manualExists = true;
    if (unprivate.has(base)) {
      // Do not add folders inside one the user shares. An existing one is only verified.
      try {
        await storage.head(manual);
        manual = await folder(base, "reservations");
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
        manualExists = false;
      }
    } else manual = await folder(base, "reservations");
    await register();
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
  /** Own containers have a generous page budget; connector scans have tighter ones. */
  async function documents(
    container: string,
    notice: ReadNotice,
    signal?: AbortSignal,
    cap = Infinity,
    maxPages = 8,
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
        if (cursor && (visited.has(cursor.url) || ++pages >= maxPages)) {
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
  /** A direct child of `reservations/` (not a deeper or merely prefixed path). */
  const isManualDocument = (url: string) =>
    manualExists && url !== manual && new URL(".", url).href === manual;
  /**
   * A document's own trust claim is honoured only when the document and its immediate container
   * are both verified owner-only (verify-only, never repaired); anyone with Write or Append on
   * either could have planted it otherwise. Each container is verified once per load, and every
   * check is bounded by the load signal. Trip documents' folder never holds trusted bookings.
   */
  function trustCheck(signal: AbortSignal) {
    const containers = new Map<string, Promise<boolean>>();
    const bounded = (check: Promise<void>) =>
      Promise.race([
        check.then(() => true),
        new Promise<boolean>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      ]).catch((error) => {
        if (signal.aborted) throw error;
        return false;
      });
    return async (url: string) => {
      const container = new URL(".", url).href;
      if (container === base) return false;
      let ok = containers.get(container);
      if (!ok) {
        ok = bounded(protect(container, true, false));
        containers.set(container, ok);
      }
      const containerOk = await ok;
      if (container === manual) {
        if (containerOk) unprivate.delete(manual);
        else unprivate.add(manual);
      }
      if (!containerOk) return false;
      return bounded(protect(url, false, false));
    };
  }
  async function load(): Promise<TripSnapshot> {
    const trips: Trip[] = [],
      reservations: Reservation[] = [];
    const notice: ReadNotice = { skipped: 0, capped: false };
    const signal = AbortSignal.timeout(budget.timeoutMs);
    const docs = new Set(
      manualExists ? await documents(manual, notice, signal, Infinity, budget.maxPages) : [],
    );
    for (const url of await documents(base, notice, signal, Infinity, budget.maxPages)) {
      try {
        const { dataset, etag } = await read(url, signal);
        const trip = parseTrip(`${url}#it`, dataset);
        if (trip) {
          trips.push({ ...trip, etag });
          for (const id of trip.reservations) docs.add(documentOf(id));
        } else notice.skipped++;
      } catch {
        notice.skipped++;
        notice.capped ||= signal.aborted;
      }
    }
    const trust = trustCheck(signal);
    for (const url of docs) {
      try {
        const scoped = assertWithinPodScope(storage.root, url);
        const verified = await trust(scoped);
        const parsed = parseReservations((await read(scoped, signal)).dataset, scoped, {
          manual: verified && isManualDocument(scoped),
          untrusted: !verified,
        });
        reservations.push(...parsed);
        if (!parsed.length) notice.skipped++;
      } catch {
        notice.skipped++;
        notice.capped ||= signal.aborted;
      }
    }
    return { trips, reservations, notice };
  }
  async function saveTrip(trip: Trip): Promise<Trip> {
    if (trip.etag === null) throw new Error("A version is required to edit this trip safely");
    const creating = !trip.etag;
    await requirePrivate(base);
    // An existing trip's own access policy may differ from its folder's (shared individually).
    if (!creating) await protect(assertWithinPodScope(base, documentOf(trip.id)), false, false);
    const created = creating
      ? await storage.create(base, null, { contentType: "text/turtle" })
      : undefined;
    const url = assertWithinPodScope(base, created?.url ?? documentOf(trip.id), {
      allowRoot: false,
    });
    let cleanupTag = created?.etagSource === "response" ? created.etag : null;
    try {
      if (creating) await protect(url, false, true);
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
      const body = await serializeTrip(saved);
      let result: Awaited<ReturnType<StorageClient["write"]>>;
      try {
        result = await storage.write(url, body, { contentType: "text/turtle", ifMatch: etag });
      } catch (error) {
        throw definiteRefusal(error) ? error : new UnconfirmedWriteError(error);
      }
      return { ...saved, etag: result.etag };
    } catch (error) {
      if (creating) await cleanup(url, cleanupTag);
      throw error;
    }
  }
  async function addReservation(input: ReservationInput): Promise<Reservation> {
    await requirePrivate(manual);
    const created = await storage.create(manual, null, { contentType: "text/turtle" });
    const url = assertWithinPodScope(manual, created.url, { allowRoot: false });
    let cleanupTag = created.etagSource === "response" ? created.etag : null;
    try {
      await protect(url, false, true);
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
        origin: "manual",
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
    const trust = trustCheck(signal);
    for (const url of docs) {
      try {
        signal.throwIfAborted();
        const parsed = parseReservations((await read(url, signal)).dataset, url, {
          untrusted: !(await trust(url)),
        });
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
    /** Type Index registration outcome; a failure is recoverable with {@link retryRegistration}. */
    get registration(): TripsRegistration {
      return registration;
    },
    /** Folders that already existed, were left untouched and are not verified owner-only. */
    get sharedFolders(): string[] {
      return [...unprivate];
    },
    /** Retry registration, first re-verifying (never repairing) a folder that was shared. */
    async retryRegistration() {
      if (unprivate.has(base)) {
        try {
          await protect(base, true, false);
          unprivate.delete(base);
        } catch (error) {
          if (!(error instanceof TripsPrivacyError)) throw error;
        }
      }
      return register();
    },
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
  const verified = verifiedOwnerOnly(storage, owner, async (url, folder) => {
    const result = await setGrants(
      [url],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { fetch, webId: owner, root, kind: folder ? "folder" : "resource", ownOnly: true },
    );
    return !result.failed.length;
  });
  return createTripsStore({
    storage,
    index,
    verifyPrivateIndex,
    protect: async (url, folder, created) => {
      if (demo) return; // Explicit session fixture, never inferred from RDF.
      await verified(url, folder, created);
    },
  });
}
/**
 * Establish owner-only access for a resource Trips just created, then verify the raw
 * effective access independently with checkOwnerOnly; a successful role write is never
 * treated as proof of privacy. A resource that already existed is only verified: its access
 * is never written, so sharing the user set up is never narrowed (and never widened).
 */
export function verifiedOwnerOnly(
  storage: StorageClient,
  owner: string,
  establish: (url: string, folder: boolean) => Promise<boolean>,
): StorePorts["protect"] {
  return async (url, folder, created) => {
    if (created && !(await establish(url, folder)))
      throw new TripsPrivacyError("Could not establish owner-only Trips storage", "unestablished");
    if (!(await checkOwnerOnly({ storage, url, ownerWebId: owner })).private)
      throw created
        ? new TripsPrivacyError("Could not verify owner-only Trips storage", "unverified")
        : new TripsPrivacyError(
            "Could not verify owner-only Trips storage. This folder is shared or its access could not be read, so Trips will not save private data in it. Trips has not changed its sharing.",
            "shared",
          );
  };
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
