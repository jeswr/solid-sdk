// AUTHORED-BY Codex (GPT-6.1 Sol)
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createGuardedFetch,
  createPodScopedFetch,
  refuseRedirects,
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
import { publishAccess, sealNewResource } from "./access.js";
import {
  EVENT_STATUS,
  type EventData,
  entities,
  eventDocumentUrl,
  type InviteeData,
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

/** Bounded listing, shared by organiser and visible guest-list views. Denial stays an error. */
export async function readReplies(
  fetch: typeof globalThis.fetch,
  eventUrl: string,
): Promise<Reply[]> {
  const document = eventDocumentUrl(eventUrl);
  const container = new URL("rsvps/", document).href;
  const members = await readContainerMembers(fetch, container, {
    scope: container,
    maxBytes: 1024 * 1024,
  });
  if (!members) return [];
  if (members.length > 500) throw new Error("This guest list is too large for this first cut");
  const replies: Reply[] = [];
  for (const { url } of members) {
    if (url.endsWith("/") || !url.endsWith(".ttl")) continue;
    const result = await fetchRdf(url, { fetch });
    const reply = entities.Rsvp.parse(url, result.dataset);
    if (reply && reply.event === entities.Event.subject(document)) replies.push({ ...reply, url });
  }
  return replies;
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
  const response = await fetch(url, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await entities.Rsvp.serialize(url, reply),
  });
  if (!response.ok) throw new Error("Couldn't send your reply");
  return { ...reply, url };
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
      if (members.length > 100) throw new Error("This first cut shows up to 100 event folders");
      const events: Invitation[] = [];
      for (const { url: folder } of members)
        if (folder.endsWith("/")) {
          try {
            events.push(await readInvitation(fetch, new URL("index.ttl", folder).href));
          } catch (e) {
            if (!(e instanceof RdfFetchError) || e.status !== 404) throw e;
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
        data.publication !== existing.publication
      )
        throw new Error("Sharing settings are fixed after creation in this first cut");
      if (!existing.etag) throw new Error("A version is required to edit");
      const { storage } = await getClient();
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
      if (members.length > 500) throw new Error("Too many invitees");
      const result: InviteeData[] = [];
      for (const { url } of members)
        if (url.endsWith(".ttl")) {
          const read = await fetchRdf(url, { fetch });
          const guest = entities.Invitee.parse(url, read.dataset);
          if (guest?.event === entities.Event.subject(event.url)) result.push(guest);
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
