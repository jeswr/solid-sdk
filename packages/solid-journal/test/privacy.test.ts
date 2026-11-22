// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EffectivePolicy } from "@jeswr/pod-access";
import { writeWac } from "@jeswr/pod-access";
import { type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { entryEntity } from "../src/model.js";
import {
  isOwnerOnly,
  isOwnerOnlyPolicy,
  protectJournal,
  verifyJournalResource,
} from "../src/privacy.js";
import { createJournalStore } from "../src/store.js";

vi.mock("@jeswr/pod-access/roles", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access/roles")>()),
  readGrants: vi.fn(),
  setGrants: vi.fn(),
}));
const owner = "https://pod.example/profile/card#me";
const root = "https://pod.example/";
const container = `${root}journal/`;
const grant: RoleGrant = {
  agent: { type: "webid", id: owner },
  role: "manager",
  inherited: false,
  source: `${container}.acl`,
};
const policy: EffectivePolicy = {
  grants: [
    {
      modes: new Set(["read", "write", "control"]),
      who: [[{ kind: "agent", webId: owner }]],
      except: [],
      appliesTo: "both",
      source: { url: `${container}.acl`, node: "#owner" },
    },
  ],
  denials: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readGrants).mockResolvedValue({
    url: container,
    grants: [grant],
    version: "opaque" as never,
  });
  vi.mocked(setGrants).mockResolvedValue({
    applied: [container],
    failed: [],
    notification: { requested: false, delivered: false },
  });
});
it("requires the owner to be the only principal, including partial-mode policies and conditions", () => {
  expect(isOwnerOnly([grant], owner)).toBe(true);
  expect(isOwnerOnly([], owner)).toBe(false);
  expect(isOwnerOnly([{ ...grant, role: "viewer" }], owner)).toBe(false);
  expect(isOwnerOnly([{ ...grant, agent: { type: "public" } }], owner)).toBe(false);
  expect(isOwnerOnly([{ ...grant, agent: { type: "webid", id: `${root}other` } }], owner)).toBe(
    false,
  );
  expect(isOwnerOnlyPolicy(policy, owner)).toBe(true);
  expect(isOwnerOnlyPolicy({ grants: [], denials: [] }, owner)).toBe(false);
  expect(isOwnerOnlyPolicy({ ...policy, denials: policy.grants }, owner)).toBe(false);
  const base = policy.grants[0] as EffectivePolicy["grants"][number];
  expect(isOwnerOnlyPolicy({ grants: [base, { ...base, who: [] }], denials: [] }, owner)).toBe(
    true,
  );
  expect(isOwnerOnlyPolicy({ grants: [{ ...base, who: [[]] }], denials: [] }, owner)).toBe(false);
  for (const item of [
    { ...base, except: [{ kind: "public" as const }] },
    { ...base, who: [] },
    { ...base, who: [[{ kind: "public" as const }]] },
    { ...base, who: [[{ kind: "agent" as const, webId: "https://other.example/#me" }]] },
    {
      ...base,
      who: [
        [
          { kind: "agent" as const, webId: owner },
          { kind: "origin" as const, origin: root },
        ],
      ],
    },
  ])
    expect(isOwnerOnlyPolicy({ grants: [item], denials: [] }, owner)).toBe(false);
  expect(
    isOwnerOnlyPolicy(
      {
        grants: [
          ...policy.grants,
          { ...base, who: [[{ kind: "public" }]], modes: new Set(["append"]) },
        ],
        denials: [],
      },
      owner,
    ),
  ).toBe(false);
});
async function fixture(own = true, parentPolicy = policy) {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { name: "journal", kind: "container" });
  await storage.create(root, await writeWac(parentPolicy, root, `${root}.acl`), {
    name: ".acl",
    contentType: "text/turtle",
  });
  const acl = `${container}.acl`;
  if (own)
    await storage.create(container, await writeWac(policy, container, acl), {
      name: ".acl",
      contentType: "text/turtle",
    });
  const original = storage.head;
  vi.spyOn(storage, "head").mockImplementation(async (url, opts) => ({
    ...(await original(url, opts)),
    links: new Map([["acl", [{ target: `${url}.acl`, params: {} }]]]),
  }));
  return storage;
}
it("seals only a new folder through conditional owner-only SDK grants and verifies both scopes", async () => {
  const storage = await fixture();
  await protectJournal(storage, container, owner, vi.fn(), true);
  expect(setGrants).toHaveBeenCalledWith(
    [container],
    [expect.objectContaining({ agent: { type: "webid", id: owner }, role: "manager" })],
    expect.objectContaining({
      ownOnly: true,
      model: "wac",
      kind: "folder",
      expected: expect.objectContaining({ version: "opaque" }),
    }),
  );
  await protectJournal(storage, container, owner, vi.fn());
  expect(setGrants).toHaveBeenCalledTimes(1);
});

it("preserves an unexpected grants-read failure without changing access", async () => {
  const storage = await fixture();
  const error = new Error("offline");
  vi.mocked(readGrants).mockRejectedValueOnce(error);
  await expect(protectJournal(storage, container, owner, vi.fn(), true)).rejects.toBe(error);
  expect(setGrants).not.toHaveBeenCalled();
});
it("refuses shared, incomplete, absent or unreadable folder privacy instead of writing journal content", async () => {
  const storage = await fixture();
  vi.mocked(readGrants).mockResolvedValueOnce({
    url: container,
    grants: [{ ...grant, agent: { type: "public" } }],
    version: "x" as never,
  });
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toThrow("shared");
  vi.mocked(setGrants).mockResolvedValueOnce({
    applied: [],
    failed: [{ url: container, error: new Error("forbidden") }],
    notification: { requested: false, delivered: false },
  });
  await expect(protectJournal(storage, container, owner, vi.fn(), true)).rejects.toThrow(
    "Couldn't make",
  );
  vi.mocked(readGrants)
    .mockResolvedValueOnce({ url: container, grants: [grant], version: "x" as never })
    .mockResolvedValueOnce({ url: container, grants: [], version: "y" as never });
  await expect(protectJournal(storage, container, owner, vi.fn(), true)).rejects.toThrow("verify");
  vi.spyOn(storage, "head").mockResolvedValueOnce({
    ...(await storage.head(container)),
    links: new Map(),
  });
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toThrow("verify");
  vi.spyOn(storage, "readRdf").mockRejectedValueOnce(
    new StorageError("forbidden", { url: container, method: "GET" }),
  );
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toMatchObject({
    code: "forbidden",
  });
});
it("checks per-entry overrides without resolving container inheritance again", async () => {
  const storage = await fixture();
  const read = vi.spyOn(storage, "readRdf");
  read.mockRejectedValueOnce(new StorageError("not-found", { url: container, method: "GET" }));
  await verifyJournalResource(storage, container, owner, vi.fn());
  expect(readGrants).not.toHaveBeenCalled();
  const shared: EffectivePolicy = {
    ...policy,
    grants: [
      ...policy.grants,
      {
        ...(policy.grants[0] as EffectivePolicy["grants"][number]),
        who: [[{ kind: "public" }]],
        modes: new Set(["append"]),
      },
    ],
  };
  const acl = `${container}.acl`;
  await storage.write(acl, await writeWac(shared, container, acl), {
    contentType: "text/turtle",
    ifMatch: (await storage.head(acl)).etag ?? "missing",
  });
  await expect(verifyJournalResource(storage, container, owner, vi.fn())).rejects.toThrow("shared");
  read.mockRejectedValueOnce(new StorageError("forbidden", { url: acl, method: "GET" }));
  await expect(verifyJournalResource(storage, container, owner, vi.fn())).rejects.toMatchObject({
    code: "forbidden",
  });
});

it("requires the WAC model and owner role for an existing private entry override", async () => {
  const storage = await fixture();
  await verifyJournalResource(storage, container, owner, vi.fn());
  expect(readGrants).toHaveBeenCalledWith(container, expect.objectContaining({ model: "wac" }));
  vi.mocked(readGrants).mockResolvedValueOnce({
    url: container,
    grants: [],
    version: "x" as never,
  });
  await expect(verifyJournalResource(storage, container, owner, vi.fn())).rejects.toThrow("verify");
  vi.mocked(readGrants).mockRejectedValueOnce({ code: "unsupported" });
  await expect(verifyJournalResource(storage, container, owner, vi.fn())).rejects.toMatchObject({
    code: "unsupported",
  });
});

function sealInto(storage: Awaited<ReturnType<typeof fixture>>) {
  vi.mocked(setGrants).mockImplementation(async () => {
    await storage.create(container, await writeWac(policy, container, `${container}.acl`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    return {
      applied: [container],
      failed: [],
      notification: { requested: false, delivered: false },
    };
  });
}

it("seals a pre-existing folder with owner-only inherited defaults using its expected snapshot", async () => {
  const storage = await fixture(false);
  sealInto(storage);
  await protectJournal(storage, container, owner, vi.fn());
  expect(setGrants).toHaveBeenCalledOnce();
  expect(vi.mocked(setGrants).mock.calls[0]?.[2]).toMatchObject({
    expected: { version: "opaque" },
    ownOnly: true,
  });
  await protectJournal(storage, container, owner, vi.fn());
  expect(setGrants).toHaveBeenCalledOnce();
});

it("recovers initialize after container creation succeeded and the first ACL write failed", async () => {
  const storage = await fixture(false);
  await storage.delete(container, { ifMatch: (await storage.head(container)).etag ?? "missing" });
  sealInto(storage);
  vi.mocked(setGrants).mockResolvedValueOnce({
    applied: [],
    failed: [{ url: container, error: new Error("connection lost") }],
    notification: { requested: false, delivered: false },
  });
  const index = { register: vi.fn(async () => {}) } as unknown as TypeIndex;
  const store = createJournalStore(storage, index, owner, vi.fn());
  await expect(store.initialize()).rejects.toThrow("Couldn't make");
  expect(index.register).not.toHaveBeenCalled();
  await store.initialize();
  expect(setGrants).toHaveBeenCalledTimes(2);
  expect(index.register).toHaveBeenCalledOnce();
});

it("requires explicit sealing for broader inherited ACLs, including partial grants hidden by roles", async () => {
  const storage = await fixture(false, {
    ...policy,
    grants: [
      ...policy.grants,
      {
        ...(policy.grants[0] as EffectivePolicy["grants"][number]),
        who: [[{ kind: "public" }]],
        modes: new Set(["append"]),
      },
    ],
  });
  const index = { register: vi.fn(async () => {}) } as unknown as TypeIndex;
  const store = createJournalStore(storage, index, owner, vi.fn());
  await expect(store.initialize()).rejects.toMatchObject({ canMakePrivate: true });
  expect(setGrants).not.toHaveBeenCalled();
  expect(index.register).not.toHaveBeenCalled();
  sealInto(storage);
  await store.makePrivate();
  await store.initialize();
  expect(setGrants).toHaveBeenCalledOnce();
  const read = await storage.readRdf(`${container}.acl`);
  const { readWac } = await import("@jeswr/pod-access");
  expect(isOwnerOnlyPolicy(readWac(read.dataset, container, `${container}.acl`), owner)).toBe(true);
});

it("doesn't confuse private parent resource access with shared member defaults", async () => {
  const storage = await fixture(false, {
    ...policy,
    grants: [
      { ...(policy.grants[0] as EffectivePolicy["grants"][number]), appliesTo: "resource" },
      {
        ...(policy.grants[0] as EffectivePolicy["grants"][number]),
        appliesTo: "members",
        who: [[{ kind: "public" }]],
      },
    ],
  });
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toMatchObject({
    canMakePrivate: true,
  });
  expect(setGrants).not.toHaveBeenCalled();
});

it("fails closed on absent inherited policies, foreign ACL links and failed post-seal verification", async () => {
  const storage = await fixture(false);
  const acl = `${root}.acl`;
  await storage.delete(acl, { ifMatch: (await storage.head(acl)).etag ?? "missing" });
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toThrow("inherited");
  vi.spyOn(storage, "head").mockResolvedValueOnce({
    ...(await storage.head(container)),
    links: new Map([["acl", [{ target: "https://foreign.example/access", params: {} }]]]),
  });
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toThrow("verify");
  await expect(protectJournal(storage, container, owner, vi.fn(), true)).rejects.toThrow("verify");
});

it("loads with three requests per entry at most and six concurrent reads, skipping widened overrides", async () => {
  const storage = await fixture();
  const count = 13;
  const sharedUrl = `${container}shared.ttl`;
  for (let i = 0; i < count; i++) {
    const name = i === 0 ? "shared.ttl" : `${i}.ttl`;
    const url = `${container}${name}`;
    await storage.create(
      container,
      await entryEntity.serialize(url, { created: new Date(), text: "Words" }),
      {
        name,
        contentType: "text/turtle",
      },
    );
  }
  await storage.create(
    container,
    await writeWac(
      {
        ...policy,
        grants: [
          ...policy.grants,
          {
            ...(policy.grants[0] as EffectivePolicy["grants"][number]),
            who: [[{ kind: "public" }]],
            modes: new Set(["append"]),
          },
        ],
      },
      sharedUrl,
      `${sharedUrl}.acl`,
    ),
    { name: "shared.ttl.acl", contentType: "text/turtle" },
  );
  const head = vi.spyOn(storage, "head");
  const originalRead = storage.readRdf;
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
    active++;
    peak = Math.max(peak, active);
    if (url.endsWith(".ttl")) await gate;
    try {
      return await originalRead(url, options);
    } finally {
      active--;
    }
  });
  const store = createJournalStore(storage, {} as TypeIndex, owner, vi.fn());
  const skipped = vi.fn();
  const listing = store.list({ onPrivacySkip: skipped });
  await vi.waitFor(() => expect(peak).toBe(6));
  release();
  const entries = await listing;
  expect(entries).toHaveLength(count - 1);
  expect(peak).toBe(6);
  expect(skipped).toHaveBeenCalledExactlyOnceWith(sharedUrl);
  expect(read.mock.calls.some(([url]) => url === sharedUrl)).toBe(false);
  expect(head).toHaveBeenCalledTimes(count + 1);
  expect(read).toHaveBeenCalledTimes(2 * count);
  expect(readGrants).toHaveBeenCalledOnce(); // Container proof only, never repeated per entry.
  await expect(store.list()).rejects.toThrow("shared");
});
