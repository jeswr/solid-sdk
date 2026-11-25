// AUTHORED-BY Claude Sonnet 5.5
// Security review C3/C4/C5/C14/C15/C18 on the memory pod, through the real pod-access code.
import { createAccessClient, type EffectivePolicy, readWac } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createEventsRepository,
  entities,
  guestListAvailable,
  PublicationError,
} from "../src/index.js";
import { eventData, harness, ROOT } from "./harness.js";

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
beforeEach(() => vi.clearAllMocks());

const CLEO = "https://cleo.example/me";
const aclPolicy = async (storage: StorageClient, url: string) => {
  const acl = `${url}.acl`;
  return readWac((await storage.readRdf(acl)).dataset, url, acl, "css", true);
};
const publicGrants = (policy: EffectivePolicy) =>
  policy.grants.filter((g) => g.who.some((c) => c.some((s) => s.kind === "public")));
const publicModes = (policy: EffectivePolicy) => publicGrants(policy).flatMap((g) => [...g.modes]);
const stateOf = async (storage: StorageClient, url: string) =>
  entities.Event.parse(url, (await storage.readRdf(url)).dataset)?.publication;
const pending = { webId: CLEO, event: `${ROOT}pending#it`, invitedAt: new Date() };

it("never grants a link holder Read on raw RSVPs, even when a guest list is requested", async () => {
  const { repository, storage } = harness();
  const event = await repository.create({ ...eventData(), guestListVisible: true }, [], "list");
  // A link invitation has no guest list: it is stored hidden, and the UI says so.
  expect(event.guestListVisible).toBe(false);
  expect(guestListAvailable(event)).toBe(false);
  const replies = new URL("rsvps/", event.url).href;
  expect(publicModes(await aclPolicy(storage, replies))).toEqual(["append"]);
  expect(publicModes(await aclPolicy(storage, event.url))).toEqual(["read"]);
});
it("serves a visible guest list only to named invitees", async () => {
  const { repository, storage } = harness();
  const event = await repository.create(
    { ...eventData(), visibility: "invitees", guestListVisible: true },
    [pending],
    "named",
  );
  expect(event.guestListVisible).toBe(true);
  const policy = await aclPolicy(storage, new URL("rsvps/", event.url).href);
  expect(publicGrants(policy)).toEqual([]);
  expect(
    policy.grants.some(
      (g) =>
        g.modes.has("read") &&
        g.who.some((c) => c.some((s) => s.kind === "agent" && s.webId === CLEO)),
    ),
  ).toBe(true);
});
it("repairs a public guest list granted by an earlier version when the organiser edits", async () => {
  const { repository, storage } = harness();
  const event = await repository.create(eventData(), [], "legacy");
  const replies = new URL("rsvps/", event.url).href;
  await createAccessClient({ storage }).share(
    replies,
    { agent: { public: true }, modes: ["read"] },
    { inherit: true },
  );
  expect(publicModes(await aclPolicy(storage, replies))).toContain("read");
  await repository.update(event, { ...event, name: "Edited" });
  expect(publicModes(await aclPolicy(storage, replies))).toEqual(["append"]);
});

/** Fail the first ACL write for one document; `sticky` then fails every later ACL write too. */
function breakAccessAt(storage: StorageClient, marker: string, sticky = false) {
  const write = storage.write.bind(storage);
  let broken = false;
  storage.write = async (url, ...rest) => {
    if (url.endsWith(".acl") && (url.includes(marker) || broken)) {
      broken = sticky;
      throw new Error("access write failed");
    }
    return write(url, ...rest);
  };
  return () => {
    storage.write = write;
  };
}

it("commits the published state before any write that exposes the audience", async () => {
  const { repository, storage } = harness();
  const log: string[] = [];
  const create = storage.create.bind(storage);
  const write = storage.write.bind(storage);
  storage.write = async (url, body, opts) => {
    const result = await write(url, body, opts);
    if (url.endsWith("/events/ordered/index.ttl")) log.push(`state:${await stateOf(storage, url)}`);
    else if (url.endsWith(".acl") && String(body).includes("agentClass")) log.push("widen");
    return result;
  };
  storage.create = async (parent, body, opts) => {
    const result = await create(parent, body, opts);
    if (String(body).includes("agentClass")) log.push("widen");
    return result;
  };
  await repository.create(eventData(), [], "ordered");
  expect(log.indexOf("state:published")).toBeGreaterThanOrEqual(0);
  expect(log.indexOf("widen")).toBeGreaterThan(log.indexOf("state:published"));
  expect(log).not.toContain("state:draft");
});
it.each([
  ["link", "/events/fail/index.ttl", []],
  ["invitees", "/events/fail/index.ttl", [pending]],
  ["link", "/events/fail/rsvps/", []],
] as const)("revokes, confirms and fails closed when %s publishing fails after widening (%s)", async (visibility, marker, invitees) => {
  const { repository, storage } = harness();
  const heal = breakAccessAt(storage, marker);
  await expect(
    repository.create({ ...eventData(), visibility }, [...invitees], "fail"),
  ).rejects.toMatchObject({ name: "PublicationError", sharingWithdrawn: true });
  heal();
  const url = `${ROOT}events/fail/index.ttl`;
  // Nothing is left shared, and the app sees a private draft, not a published event.
  expect(await stateOf(storage, url)).toBe("draft");
  for (const target of [url, `${ROOT}events/fail/rsvps/`]) {
    const policy = await aclPolicy(storage, target);
    expect(publicGrants(policy)).toEqual([]);
    expect(
      policy.grants.some((g) =>
        g.who.some((c) => c.some((s) => s.kind === "agent" && s.webId === CLEO)),
      ),
    ).toBe(false);
  }
});
it("reports when it cannot confirm that sharing was withdrawn, and survives a failed draft restore", async () => {
  const { repository, storage } = harness();
  breakAccessAt(storage, "/events/stuck/index.ttl", true);
  const write = storage.write.bind(storage);
  storage.write = async (url, body, opts) => {
    if (url.endsWith("index.ttl") && String(body).includes("draft")) throw new Error("offline");
    return write(url, body, opts);
  };
  const error = await repository.create(eventData(), [], "stuck").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PublicationError);
  expect(error).toMatchObject({ sharingWithdrawn: false });
  expect((error as Error).message).toContain("Check its sharing settings");
});
it("fails closed when publishing a saved draft fails after widening", async () => {
  const { repository, storage } = harness();
  const draft = await repository.create({ ...eventData(), publication: "draft" }, [], "df");
  const heal = breakAccessAt(storage, "/events/df/index.ttl");
  await expect(
    repository.update(draft, { ...draft, publication: "published" }),
  ).rejects.toMatchObject({ name: "PublicationError", sharingWithdrawn: true });
  heal();
  expect(await stateOf(storage, draft.url)).toBe("draft");
  expect(publicGrants(await aclPolicy(storage, draft.url))).toEqual([]);
  expect(publicGrants(await aclPolicy(storage, new URL("rsvps/", draft.url).href))).toEqual([]);
});
it("fails closed when the post-publication read fails", async () => {
  const { storage, fetch } = harness();
  const flaky: typeof globalThis.fetch = async (input, init) =>
    String(input).endsWith("/fresh/index.ttl") && (init?.method ?? "GET") === "GET"
      ? new Response(null, { status: 500 })
      : fetch(input, init);
  const repository = createEventsRepository({
    fetch: flaky,
    storageRoot: ROOT,
    owner: eventData().organizer,
  });
  await expect(repository.create(eventData(), [], "fresh")).rejects.toBeInstanceOf(
    PublicationError,
  );
  expect(publicGrants(await aclPolicy(storage, `${ROOT}events/fresh/rsvps/`))).toEqual([]);
  expect(publicGrants(await aclPolicy(storage, `${ROOT}events/fresh/index.ttl`))).toEqual([]);
});

it("is not fatal when the WebID is outside the storage: the invitation is saved and usable", async () => {
  const actual =
    await vi.importActual<typeof import("@jeswr/pod-type-index")>("@jeswr/pod-type-index");
  const foreign = "https://id.example/me";
  const { repository, register } = harness(foreign);
  vi.mocked(createTypeIndex).mockImplementation(actual.createTypeIndex);
  const event = await repository.create({ ...eventData(), organizer: foreign }, [], "abroad");
  expect(event.registrationWarning).toMatch(/Type Index/);
  expect(register).not.toHaveBeenCalled();
  expect(event.publication).toBe("published");
  expect((await repository.list()).map((e) => e.url)).toEqual([event.url]);
  const edited = await repository.update(event, { ...event, name: "Edited" });
  expect(edited.name).toBe("Edited");
  await expect(repository.registerInTypeIndex(edited)).resolves.toMatch(/Type Index/);
});
it("surfaces a failed Type Index registration as a recoverable state, and retries it", async () => {
  const { repository, register } = harness();
  register.mockRejectedValueOnce(
    new StorageError("invalid-response", { url: ROOT, method: "PUT" }),
  );
  const event = await repository.create(eventData(), [], "unindexed");
  expect(event.registrationWarning).toMatch(/private Type Index/);
  expect(event.publication).toBe("published");
  expect(await repository.registerInTypeIndex(event)).toBeUndefined();
  expect(register).toHaveBeenLastCalledWith(
    entities.Event.typeIri,
    { instance: event.url },
    { index: "private" },
  );
  await expect(
    repository.registerInTypeIndex({ ...event, url: "https://other.example/e/index.ttl" }),
  ).rejects.toThrow();
  expect((await repository.create(eventData(), [], "indexed")).registrationWarning).toBeUndefined();
});

it("names each document by the location the server assigned", async () => {
  const { repository, storage } = harness();
  const create = storage.create.bind(storage);
  storage.create = async (parent, body, opts) =>
    create(
      parent,
      body,
      opts?.name?.endsWith(".ttl") ? { ...opts, name: `assigned-${opts.name}` } : opts,
    );
  const event = await repository.create(eventData(), [pending], "renamed");
  expect(event.url).toBe(`${ROOT}events/renamed/assigned-index.ttl`);
  expect(event.name).toBe("Supper");
  const guest = `${ROOT}events/renamed/invitees/assigned-guest-0.ttl`;
  expect(entities.Invitee.parse(guest, (await storage.readRdf(guest)).dataset)?.webId).toBe(CLEO);
  // The stored subject matches the assigned location, and the invitation is shared by that URL.
  expect(entities.Event.parse(event.url, (await storage.readRdf(event.url)).dataset)).toBeTruthy();
});
it("refuses a server-assigned location that is not a plain document in the folder", async () => {
  const { repository, storage } = harness();
  const create = storage.create.bind(storage);
  let n = 0;
  for (const bad of ["x.ttl#frag", "x.ttl?q=1", "sub/", "../escape.ttl"]) {
    storage.create = async (parent, body, opts) => {
      const result = await create(parent, body, opts);
      return opts?.name === "index.ttl" ? { ...result, url: new URL(bad, parent).href } : result;
    };
    await expect(repository.create(eventData(), [], `bad-${n++}`)).rejects.toThrow();
  }
});
it("needs a version to finish saving a document the server renamed", async () => {
  const { repository, storage } = harness();
  const create = storage.create.bind(storage);
  const head = storage.head.bind(storage);
  storage.create = async (parent, body, opts) => {
    if (opts?.name !== "index.ttl") return create(parent, body, opts);
    return { ...(await create(parent, body, { ...opts, name: "a-index.ttl" })), etag: null };
  };
  storage.head = async (url, opts) => {
    const result = await head(url, opts);
    return { ...result, etag: url.includes("a-index") ? null : result.etag };
  };
  await expect(repository.create(eventData(), [], "no-etag")).rejects.toThrow("finish saving");
});
it("rejects a pre-existing event folder that is not owner-only before writing anything", async () => {
  const { repository, storage } = harness();
  await repository.create({ ...eventData(), publication: "draft" }, [], "seed");
  await createAccessClient({ storage }).share(
    `${ROOT}events/`,
    { agent: { public: true }, modes: ["read"] },
    { inherit: true },
  );
  await expect(repository.create(eventData(), [], "later")).rejects.toThrow("owner-only");
  await expect(storage.head(`${ROOT}events/later/`)).rejects.toMatchObject({ code: "not-found" });
});
it("publishes when the create response has no ETag but a HEAD supplies one", async () => {
  const { repository, storage } = harness();
  const create = storage.create.bind(storage);
  storage.create = async (parent, body, opts) => {
    const result = await create(parent, body, opts);
    return opts?.name === "index.ttl" ? { ...result, etag: null } : result;
  };
  expect((await repository.create(eventData(), [], "head-etag")).publication).toBe("published");
});
it("keeps a private draft usable when its Type Index registration fails", async () => {
  const { repository, register } = harness();
  register.mockRejectedValueOnce(new Error("no index"));
  const draft = await repository.create({ ...eventData(), publication: "draft" }, [], "d");
  expect(draft).toMatchObject({ publication: "draft", registrationWarning: expect.any(String) });
  expect((await repository.update(draft, { ...draft, name: "Renamed" })).name).toBe("Renamed");
});
it("does not restore a draft when the event has no version to restore against", async () => {
  const { repository, storage } = harness();
  breakAccessAt(storage, "/events/noversion/index.ttl");
  const write = storage.write.bind(storage);
  const head = storage.head.bind(storage);
  let failed = false;
  storage.write = async (url, ...rest) => {
    try {
      return await write(url, ...rest);
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  storage.head = async (url, opts) => {
    const result = await head(url, opts);
    return failed && url.endsWith("index.ttl") ? { ...result, etag: null } : result;
  };
  await expect(repository.create(eventData(), [], "noversion")).rejects.toBeInstanceOf(
    PublicationError,
  );
});
