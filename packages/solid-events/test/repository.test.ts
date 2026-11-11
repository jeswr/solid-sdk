// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { SsrfError } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
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
vi.mock("@jeswr/storage-client/solid", () => ({ createSolidBackend: vi.fn() }));
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
      if (method === "POST") {
        const name = new Headers(init?.headers).get("slug") ?? "assigned.ttl";
        const created = await storage.create(url, String(init?.body ?? ""), {
          name,
          contentType: "text/turtle",
        });
        return new Response(null, { status: 201, headers: { location: created.url } });
      }
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
  expect(await readReplies(fetch, event.url)).toMatchObject({ replies: [first], invalid: 0 });
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
  expect(await readReplies(fetch, `${ROOT}events/e/index.ttl`)).toMatchObject({
    replies: [],
    invalid: 0,
  });
  vi.mocked(readContainerMembers).mockResolvedValue(
    Array.from({ length: 501 }, (_, i) => ({ url: `${ROOT}events/${i}/`, container: true })),
  );
  expect(await repository.list()).toEqual([]);
  expect(
    await repository.invitees({ ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null }),
  ).toEqual([]);
  expect(await readReplies(fetch, `${ROOT}events/e/index.ttl`)).toMatchObject({
    replies: [],
    invalid: 0,
  });
  vi.mocked(readContainerMembers).mockResolvedValue([
    { url: `${ROOT}events/note.txt`, container: false },
  ]);
  expect(await repository.list()).toEqual([]);
  expect(await readReplies(fetch, `${ROOT}events/e/index.ttl`)).toMatchObject({
    replies: [],
    invalid: 1,
  });
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

it("uses CSS container Append for POST, never inherited child Write for a creating PUT", async () => {
  const { repository, storage, fetch } = harness();
  const event = await repository.create(eventData(), [], "wac");
  const container = new URL("rsvps/", event.url).href;
  const { readWac } = await import("@jeswr/pod-access");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const guest: typeof globalThis.fetch = async (input, init) => {
    const target = String(input);
    const policy = readWac(
      await parseRdf(await (await storage.read(`${container}.acl`)).text(), "text/turtle"),
      container,
      `${container}.acl`,
    );
    const mode = "append"; // CSS: POST needs container Append; PUT-create needs inherited resource Append/Write.
    const scope = target === container ? "resource" : "members";
    const allowed = policy.grants.some(
      (g) =>
        (g.appliesTo === scope || g.appliesTo === "both") &&
        g.modes.has(mode) &&
        g.who.some((c) => c.some((s) => s.kind === "public")),
    );
    if (!allowed) return new Response(null, { status: 403 });
    return fetch(input, init);
  };
  expect((await guest(`${container}direct.ttl`, { method: "PUT" })).status).toBe(403);
  const sent = await appendRsvp(
    guest,
    event,
    {
      event: entities.Event.subject(event.url),
      displayName: "Tavi",
      guestKey: "private-receipt",
      response: RSVP_RESPONSE.yes,
      additionalGuests: 0,
      repliedAt: new Date(),
    },
    "receipt",
  );
  const body = await (await storage.read(sent.url)).text();
  expect(body).not.toContain("private-receipt");
  expect(sent.guestKey).toMatch(/^sha256:[a-f0-9]{64}$/);
});
it("publishes saved drafts with their persisted invitees and closes Append access on cancellation", async () => {
  const { repository, storage } = harness();
  const webId = "https://cleo.example/me";
  const event = await repository.create(
    { ...eventData(), publication: "draft", visibility: "invitees" },
    [{ webId, event: "https://pending.example/e#it", invitedAt: new Date() }],
    "publish",
  );
  const published = await repository.update(event, { ...event, publication: "published" });
  expect(published.publication).toBe("published");
  const { readWac } = await import("@jeswr/pod-access");
  const container = new URL("rsvps/", event.url).href;
  const policy = () =>
    storage
      .readRdf(`${container}.acl`)
      .then((r) => readWac(r.dataset, container, `${container}.acl`));
  expect((await policy()).grants.some((g) => g.modes.has("append") && !g.modes.has("write"))).toBe(
    true,
  );
  await repository.update(published, { ...published, eventStatus: EVENT_STATUS.cancelled });
  expect((await policy()).grants.some((g) => g.modes.has("append") && !g.modes.has("write"))).toBe(
    false,
  );
});
it("keeps good replies when individual files are malformed, inaccessible, oversized or unrelated", async () => {
  harness();
  const event = { ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null };
  const container = new URL("rsvps/", event.url).href;
  const urls = ["good", "malformed", "denied", "oversized", "unrelated"].map(
    (n) => `${container}${n}.ttl`,
  );
  vi.mocked(readContainerMembers).mockResolvedValue(urls.map((url) => ({ url, container: false })));
  const data = {
    event: entities.Event.subject(event.url),
    agent: OWNER,
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  };
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === urls[2]) return new Response(null, { status: 403 });
    const body =
      url === urls[1]
        ? "broken {{{"
        : url === urls[3]
          ? " ".repeat(65537)
          : await entities.Rsvp.serialize(url, {
              ...data,
              event: url === urls[4] ? `${ROOT}other#it` : data.event,
            });
    return new Response(body, {
      headers: { "content-type": "text/turtle", "last-modified": "Wed, 11 Nov 2026 12:00:00 GMT" },
    });
  };
  const result = await readReplies(fetch, event.url);
  expect(result).toMatchObject({
    invalid: 4,
    replies: [{ url: urls[0], receivedAt: new Date("2026-11-11T12:00:00Z") }],
  });
});
it("reads at most 200 replies per page with six concurrent requests and can load beyond 500", async () => {
  const { repository } = harness();
  const event = await repository.create(eventData(), [], "good");
  vi.mocked(readContainerMembers).mockResolvedValueOnce([
    { url: `${repository.base}bad/`, container: true },
    { url: new URL(".", event.url).href, container: true },
  ]);
  expect(await repository.list()).toHaveLength(1);
  const urls = Array.from({ length: 501 }, (_, i) => `${ROOT}events/good/rsvps/${i}.ttl`);
  vi.mocked(readContainerMembers).mockResolvedValue(urls.map((url) => ({ url, container: false })));
  let active = 0;
  let peak = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return new Response(
      await entities.Rsvp.serialize(String(input), {
        event: entities.Event.subject(event.url),
        agent: OWNER,
        response: RSVP_RESPONSE.yes,
        additionalGuests: 0,
        repliedAt: new Date(),
      }),
      { headers: { "content-type": "text/turtle" } },
    );
  });
  const first = await readReplies(fetch, event.url);
  expect(first).toMatchObject({ total: 501, nextOffset: 200, listingLimited: false });
  expect(first.replies).toHaveLength(200);
  expect(fetch).toHaveBeenCalledTimes(200);
  expect(peak).toBe(6);
  const second = await readReplies(fetch, event.url, { offset: 200 });
  const third = await readReplies(fetch, event.url, { offset: 400 });
  expect(second.nextOffset).toBe(400);
  expect(third.nextOffset).toBeNull();
  expect(
    new Set([...first.replies, ...second.replies, ...third.replies].map((r) => r.url)).size,
  ).toBe(501);
  expect(vi.mocked(readContainerMembers).mock.calls.at(-1)?.[2]).toMatchObject({
    maxBytes: 2 * 1024 * 1024,
  });
}, 30000);
it("degrades an oversized listing to a notice while retaining access-denial errors", async () => {
  harness();
  vi.mocked(readContainerMembers).mockRejectedValueOnce(
    new RdfFetchError("budget", { code: "PARSE_LIMIT" }),
  );
  await expect(readReplies(vi.fn(), `${ROOT}events/e/index.ttl`)).resolves.toMatchObject({
    replies: [],
    invalid: 0,
    total: null,
    nextOffset: null,
    listingLimited: true,
  });
});
it("also degrades the outer transport's size cap and the real streaming listing cap", async () => {
  harness();
  vi.mocked(readContainerMembers).mockRejectedValueOnce(new SsrfError("Response exceeds cap"));
  expect(await readReplies(vi.fn(), `${ROOT}events/e/index.ttl`)).toMatchObject({
    listingLimited: true,
  });
  const actual =
    await vi.importActual<typeof import("@jeswr/ldp-container")>("@jeswr/ldp-container");
  vi.mocked(readContainerMembers).mockImplementationOnce(actual.readContainerMembers);
  const listing = `#${"x".repeat(2 * 1024 * 1024)}`;
  expect(
    await readReplies(
      async () => new Response(listing, { headers: { "content-type": "text/turtle" } }),
      `${ROOT}events/e/index.ttl`,
    ),
  ).toMatchObject({ listingLimited: true, total: null });
});
it("rejects unknown acl predicates in existing owner ACLs", async () => {
  const { repository, storage, fetch } = harness();
  await repository.create({ ...eventData(), publication: "draft" }, [], "unknown");
  const target = `${repository.base}unknown/`;
  const acl = `${target}.acl`;
  const read = await storage.read(acl);
  await storage.write(
    acl,
    `${await read.text()}\n<#hostile> <http://www.w3.org/ns/auth/acl#futurePredicate> <https://stranger.example/me> .`,
    { ifMatch: read.etag ?? "missing", contentType: "text/turtle" },
  );
  await expect(sealNewResource(storage, fetch, target, OWNER)).rejects.toThrow("unknown");
});

it("uses a server-assigned POST location even when the Slug is renamed", async () => {
  harness();
  const event = { ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null };
  const container = new URL("rsvps/", event.url).href;
  const assigned = `${container}server-assigned`;
  let body = "";
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      expect(String(_input)).toBe(container);
      expect(new Headers(init.headers).get("slug")).toBe("hint.ttl");
      body = String(init.body);
      return new Response(null, { status: 201, headers: { location: "server-assigned" } });
    }
    return new Response(body, {
      headers: {
        "content-type": "text/turtle",
        "authenticated-creator": OWNER,
        "last-modified": "invalid",
      },
    });
  };
  const sent = await appendRsvp(
    fetch,
    event,
    {
      event: entities.Event.subject(event.url),
      agent: OWNER,
      response: RSVP_RESPONSE.yes,
      additionalGuests: 0,
      repliedAt: new Date(),
      verifiedAgent: OWNER,
    } as import("../src/index.js").Reply,
    "hint",
  );
  expect(sent.url).toBe(assigned);
  expect(sent.verifiedAgent).toBeUndefined();
  vi.mocked(readContainerMembers).mockResolvedValue([{ url: assigned, container: false }]);
  const read = await readReplies(fetch, event.url);
  expect(read).toMatchObject({ replies: [sent], invalid: 0 });
  expect(read.replies[0]?.verifiedAgent).toBeUndefined();
  const proven = await readReplies(fetch, event.url, {
    authenticatedCreator: (_url, response) =>
      response.headers.get("authenticated-creator") ?? undefined,
  });
  expect(proven.replies[0]?.verifiedAgent).toBe(OWNER);
  const other = await readReplies(fetch, event.url, {
    authenticatedCreator: () => "https://stranger.example/me",
  });
  expect(other.replies[0]?.verifiedAgent).toBeUndefined();
});
it.each([
  null,
  "https://stranger.example/reply",
  "../outside.ttl",
  "#fragment",
  "reply?query=1",
  "nested/",
])("rejects an unsafe or absent POST Location %s", async (location) => {
  const event = { ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(null, { status: 201, headers: location === null ? {} : { location } }),
    );
  await expect(
    appendRsvp(fetch, event, {
      event: entities.Event.subject(event.url),
      agent: OWNER,
      response: RSVP_RESPONSE.yes,
      additionalGuests: 0,
      repliedAt: new Date(),
    }),
  ).rejects.toThrow();
});
it("keeps container denial distinct from an empty list", async () => {
  harness();
  vi.mocked(readContainerMembers).mockRejectedValueOnce(new Error("403 Forbidden"));
  await expect(readReplies(vi.fn(), `${ROOT}events/e/index.ttl`)).rejects.toThrow("403");
});
it("lists healthy invitations after a corrupt folder and reports the failure", async () => {
  const { repository, storage, fetch } = harness();
  const event = await repository.create(eventData(), [], "healthy");
  await storage.create(repository.base, null, { name: "broken", kind: "container" });
  await storage.create(`${repository.base}broken/`, "broken {{{", {
    name: "index.ttl",
    contentType: "text/turtle",
  });
  const notice = vi.fn();
  const reader = createEventsRepository({
    fetch,
    storageRoot: ROOT,
    owner: OWNER,
    onInvalidInvitation: notice,
  });
  expect(await reader.list()).toEqual([event]);
  expect(notice).toHaveBeenCalledOnce();
});
it("cancels public guest appending and retains visible guest Read access", async () => {
  const { repository, storage } = harness();
  const event = await repository.create(
    { ...eventData(), guestListVisible: true },
    [],
    "cancel-visible",
  );
  const container = new URL("rsvps/", event.url).href;
  await repository.update(event, { ...event, eventStatus: EVENT_STATUS.cancelled });
  const { readWac } = await import("@jeswr/pod-access");
  const policy = readWac(
    (await storage.readRdf(`${container}.acl`)).dataset,
    container,
    `${container}.acl`,
  );
  const guest = policy.grants.filter((g) => g.who.some((c) => c.some((s) => s.kind === "public")));
  expect(guest).toHaveLength(1);
  expect([...(guest[0]?.modes ?? [])]).toEqual(["read"]);
  expect(guest[0]?.appliesTo).toBe("both");
  const response = await storage.readRdf(`${container}.acl`);
  expect(response.dataset.size).toBeGreaterThan(0);
});
it("validates page offsets before listing or fetching", async () => {
  const fetch = vi.fn();
  for (const offset of [-1, 1.5, Infinity])
    await expect(readReplies(fetch, `${ROOT}events/e/index.ttl`, { offset })).rejects.toThrow(
      "offset",
    );
  expect(fetch).not.toHaveBeenCalled();
});
it("handles existing empty invitation and invitee listings without fetching any files", async () => {
  const { repository } = harness();
  vi.mocked(readContainerMembers).mockResolvedValue([]);
  expect(await repository.list()).toEqual([]);
  expect(
    await repository.invitees({ ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null }),
  ).toEqual([]);
});
it("requires exactly one typed reply, ignoring unrelated subjects that end in #it", async () => {
  harness();
  const url = `${ROOT}events/e/rsvps/r.ttl`;
  const event = `${ROOT}events/e/index.ttl`;
  vi.mocked(readContainerMembers).mockResolvedValue([{ url, container: false }]);
  const data = {
    agent: OWNER,
    event: entities.Event.subject(event),
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  };
  const body = await entities.Rsvp.serialize(url, data);
  const read = (text: string) =>
    readReplies(
      async () => new Response(text, { headers: { "content-type": "text/turtle" } }),
      event,
    );
  expect(await read("")).toMatchObject({ invalid: 1, replies: [] });
  expect(await read(body + (await entities.Rsvp.serialize(`${url}2`, data)))).toMatchObject({
    invalid: 1,
    replies: [],
  });
  const parse = vi.spyOn(entities.Rsvp, "parse");
  try {
    const unrelated = await entities.Event.serialize("urn:unrelated", eventData());
    expect((await read(body + unrelated)).replies).toHaveLength(1);
    expect(parse).toHaveBeenCalledWith(url, expect.anything());
    expect(parse).not.toHaveBeenCalledWith("urn:unrelated", expect.anything());
  } finally {
    parse.mockRestore();
  }
});
it("retains valid POST server times and ignores malformed ones", async () => {
  const event = { ...eventData(), url: `${ROOT}events/e/index.ttl`, etag: null };
  for (const modified of ["Wed, 11 Nov 2026 12:00:00 GMT", "invalid"]) {
    const reply = await appendRsvp(
      async () =>
        new Response(null, {
          status: 201,
          headers: {
            location: "r.ttl",
            "last-modified": modified,
          },
        }),
      event,
      {
        agent: OWNER,
        event: entities.Event.subject(event.url),
        response: RSVP_RESPONSE.yes,
        additionalGuests: 0,
        repliedAt: new Date(),
      },
    );
    expect(reply.receivedAt).toEqual(modified === "invalid" ? undefined : new Date(modified));
  }
});
it("requires the explicit demo header, retries adapter discovery and builds only demo storage", async () => {
  const { storage, fetch } = harness();
  vi.mocked(createSolidBackend).mockReturnValue(storage);
  let permitted = false;
  const transport: typeof globalThis.fetch = async (input, init) =>
    String(input) === ROOT && init?.method === "HEAD"
      ? new Response(null, { headers: permitted ? { "x-solid-demo-access-control": "none" } : {} })
      : fetch(input, init);
  const repository = createEventsRepository({
    fetch: transport,
    storageRoot: ROOT,
    owner: OWNER,
    demo: true,
  });
  await expect(repository.create(eventData(), [], "demo")).rejects.toThrow("demo adapter");
  permitted = true;
  const event = await repository.create(eventData(), [], "demo");
  expect(event.name).toBe("Supper");
  expect(createSolidBackend).toHaveBeenCalledTimes(2);
  expect(vi.mocked(createSolidBackend).mock.calls[1]?.[0]?.features?.accessControl).toMatchObject({
    evidence: "explicit-demo-fixture",
  });
});
it("preserves container HEAD failures and requires a publishing version", async () => {
  const { repository, storage } = harness();
  const head = storage.head.bind(storage);
  storage.head = async (url, opts) => {
    if (url === repository.base)
      throw new StorageError("forbidden", { url, method: "HEAD", status: 403 });
    return head(url, opts);
  };
  await expect(repository.create(eventData())).rejects.toMatchObject({ code: "forbidden" });
  storage.head = async () => {
    throw new Error("offline");
  };
  await expect(repository.create(eventData())).rejects.toThrow("offline");
  storage.head = async (url, opts) => ({
    ...(await head(url, opts)),
    etag: url.endsWith("index.ttl") ? null : (await head(url, opts)).etag,
  });
  await expect(repository.create(eventData(), [], "missing-version")).rejects.toThrow(
    "version is required to publish",
  );
});
it("rechecks and reuses pre-existing protected containers", async () => {
  const { repository } = harness();
  await repository.create({ ...eventData(), publication: "draft" }, [], "one");
  const second = await repository.create({ ...eventData(), publication: "draft" }, [], "two");
  expect(second.publication).toBe("draft");
  expect(await repository.list()).toHaveLength(2);
});
it("refuses edits to another organiser or sharing changes and ignores unrelated invitees", async () => {
  const { repository, storage } = harness();
  const event = await repository.create(eventData(), [], "edit");
  await expect(
    repository.update({ ...event, organizer: "https://other.example/me" }, event),
  ).rejects.toThrow("organiser");
  await expect(repository.update(event, { ...event, guestListVisible: true })).rejects.toThrow(
    "Sharing",
  );
  await expect(repository.update(event, { ...event, publication: "draft" })).rejects.toThrow(
    "Sharing",
  );
  const container = new URL("invitees/", event.url).href;
  await storage.create(container, "notes", { name: "readme.txt", contentType: "text/plain" });
  await storage.create(container, "", { name: "invalid.ttl", contentType: "text/turtle" });
  await storage.create(
    container,
    await entities.Invitee.serialize(`${container}other.ttl`, {
      webId: OWNER,
      event: `${ROOT}other#it`,
      invitedAt: new Date(),
    }),
    { name: "other.ttl", contentType: "text/turtle" },
  );
  expect(await repository.invitees(event)).toEqual([]);
});
it("ignores typed reply subjects other than their document's generated #it subject", async () => {
  harness();
  const url = `${ROOT}events/e/rsvps/r.ttl`;
  const event = `${ROOT}events/e/index.ttl`;
  vi.mocked(readContainerMembers).mockResolvedValue([{ url, container: false }]);
  const body = await entities.Rsvp.serialize(url, {
    agent: OWNER,
    event: entities.Event.subject(event),
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  });
  const me = body.replace(`<${url}#it>`, `<${url}#me>`);
  expect(me).not.toBe(body);
  const read = (text: string) =>
    readReplies(
      async () => new Response(text, { headers: { "content-type": "text/turtle" } }),
      event,
    );
  const parse = vi.spyOn(entities.Rsvp, "parse");
  try {
    expect(await read(me)).toMatchObject({ invalid: 1, replies: [] });
    expect(parse).not.toHaveBeenCalled();
    expect(await read(body + me)).toMatchObject({ invalid: 0, replies: [{ url, agent: OWNER }] });
    // Only the generated #it subject is parsed (validateRsvp re-parses on its own fixture IRI).
    expect(
      parse.mock.calls.map(([subject]) => subject).filter((s) => !s.includes("validation.example")),
    ).toEqual([url]);
  } finally {
    parse.mockRestore();
  }
});
it("pages through the first listing's snapshot instead of re-listing a changing container", async () => {
  harness();
  const event = `${ROOT}events/e/index.ttl`;
  const container = `${ROOT}events/e/rsvps/`;
  const urls = Array.from({ length: 201 }, (_, i) => `${container}${i}.ttl`);
  vi.mocked(readContainerMembers).mockResolvedValue([
    { url: `${container}nested/`, container: true },
    { url: `${container}.acl`, container: false },
    ...urls.map((url) => ({ url, container: false })),
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (input) =>
      new Response(
        await entities.Rsvp.serialize(String(input), {
          event: entities.Event.subject(event),
          agent: OWNER,
          response: RSVP_RESPONSE.yes,
          additionalGuests: 0,
          repliedAt: new Date(),
        }),
        { headers: { "content-type": "text/turtle" } },
      ),
  );
  const first = await readReplies(fetch, event);
  expect(first).toMatchObject({ total: 201, nextOffset: 200, members: urls });
  // The live listing changes order and grows; the next page must not skip or repeat files.
  vi.mocked(readContainerMembers).mockClear();
  vi.mocked(readContainerMembers).mockResolvedValue(
    [`${container}new.ttl`, ...[...urls].reverse()].map((url) => ({ url, container: false })),
  );
  const second = await readReplies(fetch, event, {
    offset: first.nextOffset as number,
    members: first.members,
  });
  expect(readContainerMembers).not.toHaveBeenCalled();
  expect(second).toMatchObject({ total: 201, nextOffset: null, invalid: 0, members: urls });
  expect(second.replies.map((r) => r.url)).toEqual([urls[200]]);
  expect(fetch).toHaveBeenCalledTimes(201);
  // A snapshot is still filtered and scope-checked before any file is read.
  fetch.mockClear();
  const supplied = await readReplies(fetch, event, {
    members: [
      `${container}x/`,
      `${container}x.acr`,
      `${ROOT}events/other/1.ttl`,
      urls[0] as string,
    ],
  });
  expect(supplied).toMatchObject({ total: 2, invalid: 1, replies: [{ url: urls[0] }] });
  expect(fetch).toHaveBeenCalledTimes(1);
}, 30000);
