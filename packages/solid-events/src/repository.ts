// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createGuardedFetch,
  createPodScopedFetch,
  refuseRedirects,
  SsrfError,
} from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import { createNotify, roomInvitation } from "@jeswr/pod-access/notify";
import { createTypeIndex } from "@jeswr/pod-type-index";
import {
  createPodClient,
  type PodClient,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { closeReplies, publishAccess, sealNewResource } from "./access.js";
import {
  EVENT_STATUS,
  type EventData,
  entities,
  eventDocumentUrl,
  type InviteeData,
  RDF,
  type RsvpData,
  validateEvent,
  validateInvitee,
  validateRsvp,
} from "./model.js";
import type { Reply } from "./summary.js";

export interface Invitation extends EventData {
  url: string;
  etag: string | null;
}
export interface EventsRepositoryOptions {
  fetch: typeof globalThis.fetch;
  storageRoot: string;
  owner: string;
  /** Explicit non-enforcing in-browser fixture; never enable for real storage. */
  demo?: boolean;
  onInvalidInvitation?: () => void;
}

/** Read a foreign invitation through the caller's transport and the shared SSRF guard.
 * Demo transports are selected explicitly by the UI and never used on a real session. */
export async function readInvitation(
  fetch: typeof globalThis.fetch,
  url: string,
): Promise<Invitation> {
  const document = eventDocumentUrl(url);
  const result = await fetchRdf(document, { fetch });
  const event = entities.Event.parse(document, result.dataset);
  if (!event) throw new TypeError("This isn't a supported invitation");
  validateEvent(event);
  return { ...event, url: document, etag: result.etag };
}
export function publicEventFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return refuseRedirects(
    createGuardedFetch({ fetch, maxBytes: 2 * 1024 * 1024, timeoutMs: 12000 }),
  );
}

export interface ReplyReadOptions {
  /** Offset into `members` (or a fresh listing); each call reads at most 200 files. */
  offset?: number;
  /** The `members` snapshot of an earlier call: page it without re-listing the container.
   * Every URL is still checked against the event's reply container before it is read. */
  members?: readonly string[];
  /** Trusted deployment adapter for server-authenticated creator metadata.
   * Must verify the server's contract; arbitrary headers/RDF are not identity evidence. */
  authenticatedCreator?: (url: string, response: Response) => string | undefined;
}
export interface ReplyList {
  replies: Reply[];
  invalid: number;
  total: number | null;
  nextOffset: number | null;
  listingLimited: boolean;
  /** Eligible reply file URLs of the listing this page indexes; pass back to load more. */
  members: string[];
}

/** Keep per-file failures separate from container access denial.
 * Solid listings have no ordering/offset contract: list once, then page that snapshot.
 * fetch-rdf's exported streaming reader supplies the byte cap (storage boundedText is internal). */
export async function readReplies(
  fetch: typeof globalThis.fetch,
  eventUrl: string,
  options: ReplyReadOptions = {},
): Promise<ReplyList> {
  const document = eventDocumentUrl(eventUrl);
  const container = new URL("rsvps/", document).href;
  const transport = refuseRedirects(fetch);
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Invalid reply offset");
  let members: readonly string[] | undefined = options.members;
  if (!members) {
    try {
      const listed = await readContainerMembers(transport, container, {
        scope: container,
        maxBytes: 2 * 1024 * 1024,
      });
      members = (listed ?? []).map(({ url }) => url);
    } catch (error) {
      if (
        (error instanceof RdfFetchError && error.code === "PARSE_LIMIT") ||
        error instanceof SsrfError
      )
        return {
          replies: [],
          invalid: 0,
          total: null,
          nextOffset: null,
          listingLimited: true,
          members: [],
        };
      throw error;
    }
  }
  const files = members.filter(
    (url) => !url.endsWith("/") && !url.endsWith(".acl") && !url.endsWith(".acr"),
  );
  const page = files.slice(offset, offset + 200);
  const replies: (Reply | undefined)[] = new Array(page.length);
  let invalid = 0;
  async function read(url: string, index: number) {
    try {
      assertWithinPodScope(container, url, { allowRoot: false });
      const result = await fetchRdf(url, { fetch: transport, maxBytes: 64 * 1024 });
      // A POST Slug is a hint: the document URL and RDF subject may differ.
      // Discover subjects only; every field and type is read by the generated parser.
      const subjects = new Set(
        [...result.dataset]
          .filter(
            (q) =>
              q.subject.termType === "NamedNode" &&
              q.predicate.value === RDF.type &&
              q.object.termType === "NamedNode" &&
              q.object.value === entities.Rsvp.typeIri,
          )
          .map((q) => q.subject.value),
      );
      // Parse only the generated subject of its own document; other typed subjects are ignored.
      const parsed = [...subjects]
        .map((subject) => {
          const resource = new URL(subject);
          resource.hash = "";
          return entities.Rsvp.subject(resource.href) === subject
            ? entities.Rsvp.parse(resource.href, result.dataset)
            : undefined;
        })
        .filter((r) => r !== undefined);
      if (parsed.length !== 1) throw new TypeError("Expected one reply");
      const reply = parsed[0] as RsvpData;
      validateRsvp(reply);
      if (reply.event !== entities.Event.subject(document)) throw new TypeError("Unrelated reply");
      const modified = result.headers.get("last-modified");
      const receivedAt = modified ? new Date(modified) : undefined;
      const creator = options.authenticatedCreator?.(url, result.response);
      replies[index] = {
        ...reply,
        url,
        ...(receivedAt && Number.isFinite(+receivedAt) ? { receivedAt } : {}),
        ...(creator === reply.agent && creator ? { verifiedAgent: creator } : {}),
      };
    } catch {
      invalid++;
    }
  }
  // Each batch finishes before another starts; preserve listing order despite response races.
  for (let start = 0; start < page.length; start += 6)
    await Promise.all(page.slice(start, start + 6).map((member, i) => read(member, start + i)));
  return {
    replies: replies.filter((reply): reply is Reply => reply !== undefined),
    invalid,
    total: files.length,
    nextOffset: offset + page.length < files.length ? offset + page.length : null,
    listingLimited: false,
    members: files,
  };
}

/** Append one immutable reply; changing a reply appends a newer one. No Read/Write grant needed.
 * A random receipt URL also identifies an optimistic reply before POST completes. */
export async function appendRsvp(
  fetch: typeof globalThis.fetch,
  event: Invitation,
  reply: RsvpData,
  id: string = crypto.randomUUID(),
): Promise<Reply> {
  validateRsvp(reply);
  if (reply.event !== entities.Event.subject(event.url))
    throw new TypeError("Reply references another invitation");
  if (event.publication !== "published" || event.eventStatus !== EVENT_STATUS.scheduled)
    throw new Error("This invitation isn't accepting replies");
  if (!reply.agent && event.visibility !== "link")
    throw new Error("Sign in to reply to this invitation");
  const container = new URL("rsvps/", event.url).href;
  const url = new URL(`${encodeURIComponent(id)}.ttl`, container).href;
  // Re-project generated fields so transport-only identity evidence cannot survive a new POST.
  const safeReply = entities.Rsvp.parse(url, entities.Rsvp.build(url, reply)) as RsvpData;
  if (reply.guestKey) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reply.guestKey));
    safeReply.guestKey = `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  const response = await fetch(container, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "text/turtle", slug: `${encodeURIComponent(id)}.ttl` },
    body: await entities.Rsvp.serialize(url, safeReply),
  });
  if (!response.ok) throw new Error("Couldn't send your reply");
  const location = response.headers.get("location");
  if (!location) throw new Error("The pod did not return a reply location");
  const saved = assertWithinPodScope(container, new URL(location, container).href, {
    allowRoot: false,
  });
  if (new URL(saved).hash || new URL(saved).search || saved.endsWith("/"))
    throw new Error("The pod returned an invalid reply location");
  const modified = response.headers.get("last-modified");
  const receivedAt = modified ? new Date(modified) : undefined;
  return {
    ...safeReply,
    url: saved,
    ...(receivedAt && Number.isFinite(+receivedAt) ? { receivedAt } : {}),
  };
}

export function createEventsRepository(options: EventsRepositoryOptions) {
  const { owner } = options;
  eventDocumentUrl(owner);
  const fetch = createPodScopedFetch(options.storageRoot, { fetch: options.fetch });
  const base = assertWithinPodScope(
    options.storageRoot,
    new URL("events/", options.storageRoot).href,
  );
  let client: Promise<Pick<PodClient, "storage" | "features">> | undefined;
  const getClient = () =>
    (client ??= (async () => {
      if (!options.demo) return createPodClient({ fetch, storage: options.storageRoot });
      const response = await fetch(options.storageRoot, { method: "HEAD", redirect: "error" });
      if (response.headers.get("x-solid-demo-access-control") !== "none")
        throw new Error("The demo adapter requires the in-browser fixture");
      const initial = createSolidBackend({ fetch, root: options.storageRoot });
      const features = {
        ...initial.features,
        accessControl: {
          state: "available" as const,
          evidence: "explicit-demo-fixture",
          detail: { model: "wac" as const },
        },
      };
      return {
        storage: createSolidBackend({ fetch, root: options.storageRoot, features }),
        features,
      };
    })().catch((error: unknown) => {
      client = undefined;
      throw error;
    }));
  async function container(storage: StorageClient, parent: string, name: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new TypeError("Use a simple container identifier");
    const expected = assertWithinPodScope(base, new URL(`${name}/`, parent).href);
    try {
      await storage.head(expected);
      return expected;
    } catch (e) {
      if (!(e instanceof StorageError) || e.code !== "not-found") throw e;
    }
    const created = await storage.create(parent, null, { name, kind: "container" });
    await sealNewResource(storage, fetch, created.url, owner);
    return created.url;
  }
  return {
    base,
    async list(): Promise<Invitation[]> {
      const members = await readContainerMembers(fetch, base, { scope: base });
      if (!members) return [];
      const events: Invitation[] = [];
      for (const { url: folder } of members) {
        if (folder.endsWith("/")) {
          try {
            events.push(await readInvitation(fetch, new URL("index.ttl", folder).href));
          } catch (e) {
            if (!(e instanceof RdfFetchError) || e.status !== 404) options.onInvalidInvitation?.();
          }
        }
      }
      return events;
    },
    async create(
      data: EventData,
      invitees: readonly InviteeData[] = [],
      id: string = crypto.randomUUID(),
    ): Promise<Invitation> {
      validateEvent(data);
      if (data.organizer !== owner)
        throw new TypeError("The organiser must be the signed-in account");
      const { storage, features } = await getClient();
      if (storage.protocol !== "solid")
        throw new Error("This invitation layout currently needs a Solid pod");
      await container(storage, options.storageRoot, "events");
      // Recheck a pre-existing base; never write invitation content under public inheritance.
      await sealNewResource(storage, fetch, base, owner);
      const folder = await container(storage, base, id);
      await sealNewResource(storage, fetch, folder, owner);
      await container(storage, folder, "rsvps");
      const guests = await container(storage, folder, "invitees");
      const url = new URL("index.ttl", folder).href;
      const draft = { ...data, publication: "draft" as const };
      const created = await storage.create(folder, await entities.Event.serialize(url, draft), {
        name: "index.ttl",
        contentType: "text/turtle",
      });
      await sealNewResource(storage, fetch, created.url, owner);
      const savedInvitees = invitees.map((i) => ({
        ...i,
        event: entities.Event.subject(created.url),
      }));
      for (const [index, invitee] of savedInvitees.entries()) {
        validateInvitee(invitee);
        const name = `guest-${index}.ttl`;
        await storage.create(
          guests,
          await entities.Invitee.serialize(new URL(name, guests).href, invitee),
          { name, contentType: "text/turtle" },
        );
      }
      await createTypeIndex({ storage, features, profile: owner, fetch }).register(
        entities.Event.typeIri,
        { instance: created.url },
        { index: "private" },
      );
      if (data.publication === "published") {
        await publishAccess(storage, created.url, data, savedInvitees);
        const current = await storage.head(created.url);
        if (!current.etag) throw new Error("A version is required to publish");
        await storage.write(created.url, await entities.Event.serialize(created.url, data), {
          contentType: "text/turtle",
          ifMatch: current.etag,
        });
      }
      return readInvitation(fetch, created.url);
    },
    async update(existing: Invitation, data: EventData): Promise<Invitation> {
      validateEvent(data);
      assertWithinPodScope(base, existing.url);
      if (data.organizer !== owner || existing.organizer !== owner)
        throw new TypeError("Only the organiser can edit this invitation");
      if (
        data.visibility !== existing.visibility ||
        data.guestListVisible !== existing.guestListVisible ||
        (existing.publication === "published" && data.publication !== "published")
      )
        throw new Error("Sharing settings are fixed after creation in this first cut");
      if (!existing.etag) throw new Error("A version is required to edit");
      const { storage } = await getClient();
      // Reject a stale edit before applying any access side effects.
      const current = await storage.head(existing.url);
      if (current.etag !== existing.etag)
        throw new StorageError("precondition-failed", {
          url: existing.url,
          method: "PUT",
          status: 412,
        });
      if (existing.publication === "draft" && data.publication === "published") {
        const invitees = await this.invitees(existing);
        await publishAccess(storage, existing.url, data, invitees);
      }
      if (data.eventStatus !== EVENT_STATUS.scheduled && existing.publication === "published")
        await closeReplies(storage, existing.url, owner);
      await storage.write(existing.url, await entities.Event.serialize(existing.url, data), {
        contentType: "text/turtle",
        ifMatch: existing.etag,
      });
      return readInvitation(fetch, existing.url);
    },
    async invitees(event: Invitation): Promise<InviteeData[]> {
      const container = new URL("invitees/", event.url).href;
      const members = await readContainerMembers(fetch, container, { scope: base });
      if (!members) return [];
      const result: InviteeData[] = [];
      for (const { url } of members) {
        if (url.endsWith(".ttl")) {
          const read = await fetchRdf(url, { fetch });
          const guest = entities.Invitee.parse(url, read.dataset);
          if (guest?.event === entities.Event.subject(event.url)) result.push(guest);
        }
      }
      return result;
    },
    async notify(event: Invitation, webIds: readonly string[]) {
      const notify = createNotify({ fetch: options.fetch });
      return Promise.all(
        webIds.map((webId) => notify(webId, { ...roomInvitation(event.url), actor: owner })),
      );
    },
  };
}
