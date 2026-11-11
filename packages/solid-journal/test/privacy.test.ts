// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EffectivePolicy } from "@jeswr/pod-access";
import { type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import {
  isOwnerOnly,
  isOwnerOnlyPolicy,
  protectJournal,
  verifyJournalResource,
} from "../src/privacy.js";

vi.mock("@jeswr/pod-access/roles", () => ({ readGrants: vi.fn(), setGrants: vi.fn() }));
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
async function fixture() {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { name: "journal", kind: "container" });
  const { writeWac } = await import("@jeswr/pod-access");
  const acl = `${container}.acl`;
  await storage.create(container, await writeWac(policy, container, acl), {
    name: ".acl",
    contentType: "text/turtle",
  });
  const original = storage.head;
  vi.spyOn(storage, "head").mockImplementation(async (url, opts) => ({
    ...(await original(url, opts)),
    links: new Map([["acl", [{ target: acl, params: {} }]]]),
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
it("checks per-entry overrides and permits only confirmed absence of an own ACL", async () => {
  const storage = await fixture();
  const read = vi.spyOn(storage, "readRdf");
  read.mockRejectedValueOnce(new StorageError("not-found", { url: container, method: "GET" }));
  await verifyJournalResource(storage, container, owner, vi.fn());
  read.mockRejectedValueOnce(new StorageError("not-found", { url: container, method: "GET" }));
  await expect(protectJournal(storage, container, owner, vi.fn())).rejects.toMatchObject({
    code: "not-found",
  });
  vi.mocked(readGrants).mockResolvedValueOnce({
    url: container,
    grants: [],
    version: "x" as never,
  });
  await expect(verifyJournalResource(storage, container, owner, vi.fn())).rejects.toThrow("shared");
});
