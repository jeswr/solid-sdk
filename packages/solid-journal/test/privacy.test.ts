// AUTHORED-BY Claude Sonnet 5.5
// Journal privacy runs through the shared fail-closed verifier (`checkOwnerOnly`) for WAC and
// ACP pods alike. Nothing here mocks the verifier: it reads real ACL/ACR documents served by a
// faithful fake Solid server. Only the role writer (covered by pod-access and by
// privacy-integration.test.ts) is mocked, to observe when sealing is attempted.
import { checkOwnerOnly } from "@jeswr/pod-access";
import { readGrants, setGrants } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import type { LinkTarget, StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { entryEntity } from "../src/model.js";
import { JournalPrivacyError, protectJournal, verifyJournalResource } from "../src/privacy.js";
import { createJournalStore } from "../src/store.js";

vi.mock("@jeswr/pod-access/roles", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access/roles")>()),
  readGrants: vi.fn(),
  setGrants: vi.fn(),
}));
const root = "https://pod.example/";
const container = `${root}journal/`;
const owner = "https://pod.example/profile/card#me";
const bob = "https://bob.example/#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix acp: <http://www.w3.org/ns/solid/acp#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n`;
const ownerModes = "acl:Read, acl:Write, acl:Control";

type Model = "wac" | "acp";
/** WAC owner rule: `scope` is accessTo (own resource) and optionally default (members). */
const wac = (
  target: string,
  agent: string,
  modes = ownerModes,
  { members = true, type = true, as = target } = {},
) =>
  `[] ${type ? "a acl:Authorization;" : ""} acl:agent <${agent}>; acl:accessTo <${as}>;${
    members ? ` acl:default <${target}>;` : ""
  } acl:mode ${modes}.\n`;
const wacPublic = (target: string, extra = {}) =>
  wac(target, bob, "acl:Read", extra).replace(
    "acl:agent <" + bob + ">",
    "acl:agentClass foaf:Agent",
  );
const acp = (resource: string, matcher: string, scope = "acp:accessControl") =>
  `<> a acp:AccessControlResource; acp:resource <${resource}>; ${scope} <#c>.
<#c> acp:apply <#p>. <#p> acp:allow acl:Read; acp:allOf <#m>. <#m> ${matcher}.\n`;

/**
 * A pod whose access documents are real memory resources. `documents` maps a resource URL to
 * the turtle body of its own ACL/ACR; a missing entry is a real 404, so inheritance applies.
 */
async function pod(documents: Record<string, string | undefined>, model: Model = "wac") {
  const memory = createMemoryStorage({ protocol: "solid", root });
  await memory.create(root, null, { name: "journal", kind: "container" });
  const extension = model === "wac" ? ".acl" : ".acr";
  const endpoint = (url: string) => `${url}${extension}`;
  const put = async (url: string, body: string) => {
    const parent = url.endsWith("/") ? url : url.slice(0, url.lastIndexOf("/") + 1);
    const name = endpoint(url).slice(parent.length);
    await memory.create(parent, PREFIX + body, { name, contentType: "text/turtle" });
  };
  for (const [url, body] of Object.entries(documents)) if (body !== undefined) await put(url, body);
  const isAccess = (url: string) => url.endsWith(extension);
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model }, evidence: "fixture" },
    },
    async head(url, options) {
      const head = await memory.head(url, options);
      if (isAccess(url)) return head;
      const links = new Map<string, readonly LinkTarget[]>(head.links);
      links.set("acl", [{ target: endpoint(url), params: {} }]);
      if (url === root) links.set("type", [{ target: PIM_STORAGE, params: {} }]);
      else links.delete("type");
      return { ...head, links };
    },
    async list(url, options) {
      const page = await memory.list(url, options);
      return { ...page, items: page.items.filter((item) => !isAccess(item.url)) };
    },
  };
  const body = async (url: string) => (await memory.read(endpoint(url))).text();
  const replace = async (url: string, content: string) => {
    const target = endpoint(url);
    await memory.write(target, PREFIX + content, {
      contentType: "text/turtle",
      ifMatch: (await memory.head(target)).etag ?? "*",
    });
  };
  const create = vi.spyOn(memory, "create");
  const write = vi.spyOn(memory, "write");
  /** Access documents written since the spies were installed. */
  const accessWrites = () => [
    ...create.mock.calls.filter(([, , options]) => options?.name?.endsWith(extension)),
    ...write.mock.calls.filter(([url]) => url.endsWith(extension)),
  ];
  /** Entries exist (as empty resources) before they are verified, as in the store. */
  const entry = (url: string) =>
    memory.create(container, "", { name: url.slice(container.length), contentType: "text/turtle" });
  return { memory, storage, put, replace, body, endpoint, accessWrites, entry };
}
const ownerWac = { [root]: wac(root, owner), [container]: wac(container, owner) };
const ownerMatcher = `acp:agent <${owner}>`;
const publicMatcher = "acp:agent acp:PublicAgent";
const aclFor = (url: string, model: Model = "wac") => `${url}${model === "wac" ? ".acl" : ".acr"}`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readGrants).mockResolvedValue({
    url: container,
    grants: [],
    version: "opaque" as never,
  });
});
/** Role-writer stand-in: persists an owner-only own ACL for the container, as setGrants would. */
function sealing(server: Awaited<ReturnType<typeof pod>>, body = wac(container, owner)) {
  vi.mocked(setGrants).mockImplementation(async () => {
    await server.put(container, body).catch(() => server.replace(container, body));
    return {
      applied: [container],
      failed: [],
      notification: { requested: false, delivered: false },
    };
  });
}

describe("verifying the folder (WAC)", () => {
  it("accepts an owner-only own ACL without writing any access document", async () => {
    const server = await pod(ownerWac);
    await protectJournal(server.storage, container, owner, vi.fn());
    expect(setGrants).not.toHaveBeenCalled();
    expect(server.accessWrites()).toEqual([]);
  });

  it("accepts a folder that inherits owner-only defaults, leaving it unwritten", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    await protectJournal(server.storage, container, owner, vi.fn());
    expect(setGrants).not.toHaveBeenCalled();
    expect(server.accessWrites()).toEqual([]);
  });

  it("refuses a shared own ACL as repairable, leaving its bytes unchanged", async () => {
    const server = await pod({
      [root]: wac(root, owner),
      [container]: wac(container, owner) + wac(container, bob, "acl:Read"),
    });
    const before = await server.body(container);
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toMatchObject({
      message: expect.stringContaining("shared"),
      canMakePrivate: true,
    });
    expect(await server.body(container)).toBe(before);
    expect(setGrants).not.toHaveBeenCalled();
  });

  it("never inherits a looser parent ACL", async () => {
    const server = await pod({ [root]: wac(root, owner) + wacPublic(root) });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toMatchObject({
      canMakePrivate: true,
    });
    expect(setGrants).not.toHaveBeenCalled();
  });

  it("is not fooled by a resource-only parent rule next to shared member defaults", async () => {
    const server = await pod({
      [root]: wac(root, owner, ownerModes, { members: false }) + wacPublic(root, { members: true }),
    });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toMatchObject({
      canMakePrivate: true,
    });
  });

  it("fails closed, without offering repair, when the policy is unverifiable", async () => {
    const server = await pod({}); // No access document anywhere, not even at the root.
    const failure = await protectJournal(server.storage, container, owner, vi.fn()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(JournalPrivacyError);
    expect(failure).toMatchObject({
      message: expect.stringContaining("verify"),
      canMakePrivate: false,
    });
  });

  it("refuses untyped WAC rules that the old role-based check ignored", async () => {
    const untyped = wacPublic(container, { type: false });
    const server = await pod({
      [root]: wac(root, owner),
      [container]: wac(container, owner) + untyped,
    });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toMatchObject({
      message: expect.stringContaining("verify"),
      canMakePrivate: false,
    });
    await server.entry(`${container}a.ttl`);
    await expect(verifyJournalResource(server.storage, `${container}a.ttl`, owner)).rejects.toThrow(
      "verify",
    );
  });

  it("refuses a non-canonical access target", async () => {
    const server = await pod({
      [root]: wac(root, owner),
      [container]: wac(container, owner, ownerModes, { as: "https://pod.example:443/journal/" }),
    });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toThrow(
      "verify",
    );
  });

  it("turns transport failures into a refusal instead of trusting the folder", async () => {
    const server = await pod(ownerWac);
    const acl = aclFor(container);
    const original = server.storage.head;
    vi.spyOn(server.storage, "head").mockImplementation(async (url, options) => {
      if (url === acl)
        throw new StorageError("forbidden", { url: acl, method: "HEAD", status: 403 });
      return original(url, options);
    });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toBeInstanceOf(
      JournalPrivacyError,
    );
    await expect(verifyJournalResource(server.storage, container, owner)).rejects.toThrow("verify");
  });

  it("refuses an ACL representation whose validator is stale", async () => {
    const server = await pod(ownerWac);
    const read = await server.storage.read(aclFor(container));
    vi.spyOn(server.storage, "read").mockResolvedValue({ ...read, etag: '"stale"' });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toThrow(
      "verify",
    );
  });

  it("stops at the storage root: a sub-root that is not pim:Storage is refused", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    const head = server.storage.head;
    vi.spyOn(server.storage, "head").mockImplementation(async (url, options) => {
      const result = await head(url, options);
      if (url !== root) return result;
      const links = new Map(result.links);
      links.delete("type");
      return { ...result, links };
    });
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toThrow(
      "verify",
    );
  });

  it("refuses an LWS pod, which checkOwnerOnly cannot represent", async () => {
    const memory = createMemoryStorage({ protocol: "lws", root });
    await memory.create(root, null, { name: "journal", kind: "container" });
    await expect(protectJournal(memory, container, owner, vi.fn())).rejects.toMatchObject({
      message: expect.stringContaining("verify"),
      canMakePrivate: false,
    });
  });
});

describe("sealing", () => {
  it("seals only on request, with the SDK role writer, then verifies independently", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    sealing(server);
    await protectJournal(server.storage, container, owner, vi.fn(), true);
    expect(readGrants).toHaveBeenCalledOnce();
    expect(setGrants).toHaveBeenCalledWith(
      [container],
      [expect.objectContaining({ agent: { type: "webid", id: owner }, role: "manager" })],
      expect.objectContaining({
        ownOnly: true,
        kind: "folder",
        expected: expect.objectContaining({ version: "opaque" }),
      }),
    );
    // The access model is left for the SDK to detect, so ACP pods are not excluded.
    expect(vi.mocked(setGrants).mock.calls[0]?.[2]).not.toHaveProperty("model");
    expect(vi.mocked(readGrants).mock.calls[0]?.[1]).not.toHaveProperty("model");
    expect(
      await checkOwnerOnly({ storage: server.storage, url: container, ownerWebId: owner }),
    ).toEqual({ private: true });
  });

  it("never claims privacy because the role writer succeeded", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    sealing(server, wac(container, owner) + wac(container, bob, "acl:Read"));
    await expect(
      protectJournal(server.storage, container, owner, vi.fn(), true),
    ).rejects.toMatchObject({
      message: "Couldn't verify private journal access",
      canMakePrivate: false,
    });
  });

  it("reports a failed seal with its cause and never writes content", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    const forbidden = new Error("forbidden");
    vi.mocked(setGrants).mockResolvedValue({
      applied: [],
      failed: [{ url: container, error: forbidden }],
      notification: { requested: false, delivered: false },
    });
    await expect(
      protectJournal(server.storage, container, owner, vi.fn(), true),
    ).rejects.toMatchObject({
      message: "Couldn't make your journal private",
      cause: forbidden,
    });
  });

  it("preserves an unexpected grants-read failure without changing access", async () => {
    const server = await pod({ [root]: wac(root, owner) });
    const error = new Error("offline");
    vi.mocked(readGrants).mockRejectedValue(error);
    await expect(protectJournal(server.storage, container, owner, vi.fn(), true)).rejects.toBe(
      error,
    );
    expect(setGrants).not.toHaveBeenCalled();
  });

  it("passes a trusted ACP dialect to the role writer and to the verifier", async () => {
    const server = await pod({ [root]: acp(root, ownerMatcher) }, "acp");
    sealing(server, acp(container, ownerMatcher, "acp:memberAccessControl"));
    await protectJournal(server.storage, container, owner, vi.fn(), true, "css");
    expect(vi.mocked(setGrants).mock.calls[0]?.[2]).toMatchObject({ implementation: "css" });
    expect(vi.mocked(readGrants).mock.calls[0]?.[1]).toMatchObject({ implementation: "css" });
  });
});

describe("entries and photos", () => {
  const entry = `${container}entry.ttl`;
  it("accepts an entry inheriting the verified folder and one with an owner-only override", async () => {
    const server = await pod(ownerWac);
    await server.entry(entry);
    await verifyJournalResource(server.storage, entry, owner);
    await server.put(entry, wac(entry, owner, ownerModes, { members: false }));
    await verifyJournalResource(server.storage, entry, owner);
    expect(server.accessWrites().length).toBe(1);
  });

  it("refuses an entry whose own ACL is shared, without offering folder repair", async () => {
    const server = await pod({
      ...ownerWac,
      [entry]:
        wac(entry, owner, ownerModes, { members: false }) +
        wac(entry, bob, "acl:Read", { members: false }),
    });
    await server.entry(entry);
    const failure = await verifyJournalResource(server.storage, entry, owner).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ message: expect.stringContaining("entry is shared") });
    expect(failure).toMatchObject({ canMakePrivate: false });
  });

  it("refuses every entry once the folder ACL has been loosened (no stale inheritance)", async () => {
    const server = await pod(ownerWac);
    await server.entry(entry);
    await verifyJournalResource(server.storage, entry, owner);
    await server.replace(container, wac(container, owner) + wacPublic(container));
    await expect(verifyJournalResource(server.storage, entry, owner)).rejects.toThrow("shared");
  });

  it("fails closed for an entry when nothing can be verified", async () => {
    const server = await pod({});
    await server.entry(entry);
    await expect(verifyJournalResource(server.storage, entry, owner)).rejects.toThrow(
      "Couldn't verify private journal entry access",
    );
  });
});

describe("ACP pods use the same shared verifier", () => {
  const entry = `${container}entry.ttl`;
  const acpPod = (matcher = ownerMatcher) =>
    pod(
      {
        [root]: acp(root, ownerMatcher),
        [container]: acp(container, matcher, "acp:memberAccessControl"),
        [entry]: acp(entry, ownerMatcher),
      },
      "acp",
    );

  it("verifies an owner-only ACP folder and entry when the dialect is trusted", async () => {
    const server = await acpPod();
    await server.entry(entry);
    await protectJournal(server.storage, container, owner, vi.fn(), false, "css");
    await verifyJournalResource(server.storage, entry, owner, "css");
    expect(setGrants).not.toHaveBeenCalled();
    expect(server.accessWrites()).toEqual([]);
  });

  it("fails closed without a trusted dialect", async () => {
    const server = await acpPod();
    await server.entry(entry);
    await expect(protectJournal(server.storage, container, owner, vi.fn())).rejects.toMatchObject({
      message: expect.stringContaining("verify"),
      canMakePrivate: false,
    });
    await expect(verifyJournalResource(server.storage, entry, owner)).rejects.toThrow("verify");
  });

  it("reports a public ACP member policy as shared and repairable", async () => {
    const server = await acpPod(publicMatcher);
    await server.entry(entry);
    await expect(
      protectJournal(server.storage, container, owner, vi.fn(), false, "css"),
    ).rejects.toMatchObject({ canMakePrivate: true });
  });

  it("refuses an entry without an ACR rather than assuming inheritance", async () => {
    const server = await pod(
      {
        [root]: acp(root, ownerMatcher),
        [container]: acp(container, ownerMatcher, "acp:memberAccessControl"),
      },
      "acp",
    );
    await server.entry(entry);
    await expect(verifyJournalResource(server.storage, entry, owner, "css")).rejects.toThrow(
      "verify",
    );
  });
});

describe("store wiring", () => {
  const data = { created: new Date("2026-11-11"), text: "A good day." };
  const index = () => ({ register: vi.fn(async () => {}) }) as unknown as TypeIndex;

  it("seals a container it just created, but only verifies one that already exists", async () => {
    const created = await pod({ [root]: wac(root, owner) });
    await created.memory.delete(container, {
      ifMatch: (await created.memory.head(container)).etag ?? "*",
    });
    sealing(created);
    const store = createJournalStore(created.storage, index(), owner, vi.fn());
    await store.initialize();
    expect(setGrants).toHaveBeenCalledOnce();
    await store.initialize(); // Now it exists: verified, never rewritten.
    expect(setGrants).toHaveBeenCalledOnce();
    expect(await store.save(data)).toMatchObject({ text: data.text });
  });

  it("leaves an existing shared folder unchanged until the user explicitly makes it private", async () => {
    const shared = await pod({
      [root]: wac(root, owner),
      [container]: wac(container, owner) + wacPublic(container),
    });
    const before = await shared.body(container);
    const register = vi.fn(async () => {});
    const store = createJournalStore(
      shared.storage,
      { register } as unknown as TypeIndex,
      owner,
      vi.fn(),
    );
    await expect(store.initialize()).rejects.toMatchObject({ canMakePrivate: true });
    await expect(store.save(data)).rejects.toBeInstanceOf(JournalPrivacyError);
    expect(register).not.toHaveBeenCalled();
    expect(setGrants).not.toHaveBeenCalled();
    expect(await shared.body(container)).toBe(before);
    sealing(shared);
    await store.makePrivate(); // The explicit repair.
    expect(setGrants).toHaveBeenCalledOnce();
  });

  it("loads entries with six concurrent reads, skipping entries whose own ACL was widened", async () => {
    const server = await pod(ownerWac);
    const count = 13;
    const sharedUrl = `${container}shared.ttl`;
    for (let i = 0; i < count; i++) {
      const name = i === 0 ? "shared.ttl" : `${i}.ttl`;
      const url = `${container}${name}`;
      await server.memory.create(
        container,
        await entryEntity.serialize(url, { created: new Date(), text: "Words" }),
        { name, contentType: "text/turtle" },
      );
    }
    await server.put(
      sharedUrl,
      wac(sharedUrl, owner, ownerModes, { members: false }) +
        wacPublic(sharedUrl, { members: false }),
    );
    const originalRead = server.storage.readRdf;
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(server.storage, "readRdf").mockImplementation(async (url, options) => {
      active++;
      peak = Math.max(peak, active);
      if (url.endsWith(".ttl")) await gate;
      try {
        return await originalRead(url, options);
      } finally {
        active--;
      }
    });
    const store = createJournalStore(server.storage, {} as TypeIndex, owner, vi.fn());
    const skipped = vi.fn();
    const listing = store.list({ onPrivacySkip: skipped });
    await vi.waitFor(() => expect(peak).toBe(6));
    release();
    expect(await listing).toHaveLength(count - 1);
    expect(peak).toBe(6);
    expect(skipped).toHaveBeenCalledExactlyOnceWith(sharedUrl);
    expect(read.mock.calls.some(([url]) => url === sharedUrl)).toBe(false);
    await expect(store.list()).rejects.toThrow("shared"); // No reporting consumer: refuse the list.
  });
});
