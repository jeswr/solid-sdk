// AUTHORED-BY Codex (GPT-6.1 Sol)

import { readContainerMembers } from "@jeswr/ldp-container";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { publishAccess, sealNewResource } from "../src/access.js";
import {
  appendRsvp,
  createEventsRepository,
  EVENT_STATUS,
  type EventData,
  entities,
  publicEventFetch,
  RSVP_RESPONSE,
  readInvitation,
  readReplies,
} from "../src/index.js";

vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
vi.mock("@jeswr/ldp-container", () => ({ readContainerMembers: vi.fn() }));
vi.mock("@jeswr/pod-type-index", () => ({ createTypeIndex: vi.fn() }));
vi.mock("@jeswr/pod-access/notify", () => ({
  createNotify: () => vi.fn().mockResolvedValue({ delivered: true }),
  roomInvitation: (url: string) => ({ type: "Offer", object: url }),
}));
const ROOT = "https://host.example/";
const OWNER = `${ROOT}profile/card#me`;
const eventData = (): EventData => ({
  name: "Supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: OWNER,
  eventStatus: EVENT_STATUS.scheduled,
  guestListVisible: false,
  visibility: "link",
  publication: "published",
  created: new Date("2026-11-11T12:00:00Z"),
  modified: new Date("2026-11-11T12:00:00Z"),
});
function harness() {
  const storage = createMemoryStorage({ root: ROOT, protocol: "solid" });
  storage.features.accessControl = {
    state: "available",
    detail: { model: "wac" },
    evidence: "fixture",
  };
  const head = storage.head.bind(storage);
  storage.head = async (...args) => ({
    ...(await head(...args)),
    links: new Map([["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    try {
      if (method === "PUT") {
        const headers = new Headers(init?.headers);
        if (headers.get("if-none-match") === "*") {
          await storage.create(new URL(".", url).href, String(init?.body ?? ""), {
            name: url.split("/").at(-1),
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        } else
          await storage.write(url, String(init?.body ?? ""), {
            contentType: "text/turtle",
            ifMatch: headers.get("if-match") ?? "missing",
          });
        return new Response(null, { status: 201 });
      }
      const result = await storage.read(url);
      return new Response(await result.text(), {
        headers: { "content-type": "text/turtle", etag: result.etag ?? "" },
      });
    } catch (error) {
      if (error instanceof StorageError) return new Response(null, { status: error.status ?? 500 });
      throw error;
    }
  };
  vi.mocked(createPodClient).mockResolvedValue({ storage, features: storage.features } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  vi.mocked(readContainerMembers).mockImplementation(async (_fetch, url) => {
    try {
      const entries = [];
      for await (const e of storage.listAll(url))
        entries.push({ url: e.url, container: e.kind === "container" });
      return entries;
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found") return null;
      throw error;
    }
  });
  const register = vi.fn().mockResolvedValue(undefined);
  vi.mocked(createTypeIndex).mockReturnValue({ register } as unknown as ReturnType<
    typeof createTypeIndex
  >);
  return {
    storage,
    fetch,
    register,
    repository: createEventsRepository({ fetch, storageRoot: ROOT, owner: OWNER }),
  };
}
beforeEach(() => vi.clearAllMocks());
it("persists and discovers invitations, independent invitees, replies, notification delivery and edits", async () => {
  const { repository, storage, fetch, register } = harness();
  expect(await repository.list()).toEqual([]);
  const invited = {
    webId: "https://cleo.example/me",
    event: "https://pending.example/e#it",
    invitedAt: new Date(),
  };
  const event = await repository.create(eventData(), [invited], "supper");
  expect(register).toHaveBeenCalledWith(
    entities.Event.typeIri,
    { instance: event.url },
    { index: "private" },
  );
  expect(await repository.list()).toHaveLength(1);
  expect(await repository.invitees(event)).toMatchObject([
    { webId: invited.webId, event: entities.Event.subject(event.url) },
  ]);
  expect(await repository.notify(event, [invited.webId])).toEqual([{ delivered: true }]);
  const first = await appendRsvp(fetch, event, {
    agent: invited.webId,
    event: entities.Event.subject(event.url),
    response: RSVP_RESPONSE.yes,
    additionalGuests: 1,
    repliedAt: new Date(),
  });
  expect(await readReplies(fetch, event.url)).toEqual([first]);
  const changed = await repository.update(event, { ...event, name: "Updated" });
  expect(changed.name).toBe("Updated");
  await expect(repository.update(event, { ...event, name: "Stale" })).rejects.toMatchObject({
    code: "precondition-failed",
  });
  await expect(repository.update({ ...changed, etag: null }, changed)).rejects.toThrow("version");
  await expect(repository.update(changed, { ...changed, visibility: "invitees" })).rejects.toThrow(
    "Sharing",
  );
  await expect(
    repository.update(changed, { ...changed, organizer: invited.webId }),
  ).rejects.toThrow("organiser");
  await storage.create(repository.base, null, { name: "empty", kind: "container" });
  expect(await repository.list()).toHaveLength(1);
});
it("allows private drafts and shares only with invited WebIDs", async () => {
  const { repository, storage, fetch } = harness();
  const draft = await repository.create({ ...eventData(), publication: "draft" }, [], "draft");
  expect(draft.publication).toBe("draft");
  await publishAccess(
    storage,
    draft.url,
    { ...draft, visibility: "invitees", guestListVisible: true },
    [
      {
        webId: "https://cleo.example/me",
        event: entities.Event.subject(draft.url),
        invitedAt: new Date(),
      },
      { displayName: "Tavi", event: entities.Event.subject(draft.url), invitedAt: new Date() },
    ],
  );
  await sealNewResource(storage, fetch, `${ROOT}events/draft/invitees/`, OWNER);
});
it("refuses bad organisers, unsafe IDs and unsupported storage without writing content", async () => {
  const { repository, storage } = harness();
  await expect(
    repository.create({ ...eventData(), organizer: "https://other.example/me" }),
  ).rejects.toThrow("organiser");
  await expect(repository.create(eventData(), [], "../escape")).rejects.toThrow();
  Object.defineProperty(storage, "protocol", { value: "lws" });
  await expect(repository.create(eventData())).rejects.toThrow("Solid pod");
});
it("bounds lists, filters unrelated reply entities, and keeps read errors distinct from absence", async () => {
  const { repository, fetch } = harness();
  vi.mocked(readContainerMembers).mockResolvedValue(null);
  expect(
    await repository.invitees({ ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null }),
  ).toEqual([]);
  expect(await readReplies(fetch, `${ROOT}events/e/index.ttl`)).toEqual([]);
  vi.mocked(readContainerMembers).mockResolvedValue(
    Array.from({ length: 501 }, (_, i) => ({ url: `${ROOT}events/${i}/`, container: true })),
  );
  await expect(repository.list()).rejects.toThrow("100");
  await expect(
    repository.invitees({ ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null }),
  ).rejects.toThrow("Too many");
  await expect(readReplies(fetch, `${ROOT}events/e/index.ttl`)).rejects.toThrow("too large");
  vi.mocked(readContainerMembers).mockResolvedValue([
    { url: `${ROOT}events/note.txt`, container: false },
  ]);
  expect(await repository.list()).toEqual([]);
  expect(await readReplies(fetch, `${ROOT}events/e/index.ttl`)).toEqual([]);
  await expect(
    readInvitation(
      async () => new Response("", { status: 200, headers: { "content-type": "text/turtle" } }),
      `${ROOT}bad`,
    ),
  ).rejects.toThrow("supported invitation");
  await expect(
    readInvitation(async () => new Response(null, { status: 403 }), `${ROOT}private`),
  ).rejects.toMatchObject({ status: 403 });
});
it("refuses replies for the wrong event, private anonymous guests, cancelled events and failed writes", async () => {
  const event = { ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null };
  const reply = {
    event: entities.Event.subject(event.url),
    displayName: "Cleo",
    guestKey: "key",
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  };
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  await expect(appendRsvp(fetch, event, { ...reply, event: `${ROOT}other#it` })).rejects.toThrow(
    "another",
  );
  await expect(
    appendRsvp(fetch, { ...event, eventStatus: EVENT_STATUS.cancelled }, reply),
  ).rejects.toThrow("accepting");
  await expect(appendRsvp(fetch, { ...event, visibility: "invitees" }, reply)).rejects.toThrow(
    "Sign in",
  );
  await expect(appendRsvp(fetch, event, reply)).rejects.toThrow("send");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("uses the shared guard to refuse private network invitation fetches", async () => {
  const fetch = vi.fn();
  await expect(publicEventFetch(fetch)("http://127.0.0.1/event")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("requires advertised WAC, Control and a single safe access link; refuses existing public ACLs", async () => {
  const { storage } = harness();
  const target = (await storage.create(ROOT, null, { name: "test", kind: "container" })).url;
  const missing = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  storage.features.accessControl.state = "unknown";
  await expect(sealNewResource(storage, missing, target, OWNER)).rejects.toThrow("WAC");
  await expect(publishAccess(storage, `${ROOT}event`, eventData(), [])).rejects.toThrow("WAC");
  storage.features.accessControl.state = "available";
  const head = storage.head.bind(storage);
  storage.head = async (url) => ({
    ...(await head(url)),
    allow: { control: false, read: true, write: true, append: true },
  });
  await expect(sealNewResource(storage, missing, target, OWNER)).rejects.toThrow("Control");
  storage.head = async (url) => ({ ...(await head(url)), links: new Map() });
  await expect(sealNewResource(storage, missing, target, OWNER)).rejects.toThrow("unambiguous");
  storage.head = head;
  await expect(
    sealNewResource(
      storage,
      async () => new Response("", { status: 200, headers: { "content-type": "text/turtle" } }),
      target,
      OWNER,
    ),
  ).rejects.toThrow("owner-only");
  await expect(
    sealNewResource(storage, async () => new Response(null, { status: 403 }), target, OWNER),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    sealNewResource(
      storage,
      async (_url, init) => new Response(null, { status: init?.method === "PUT" ? 412 : 404 }),
      target,
      OWNER,
    ),
  ).rejects.toThrow("protect");
});
