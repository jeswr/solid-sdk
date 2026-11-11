// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { RoleGrant } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { type Entry, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWalletRepository,
  limitedText,
  ownerOnly,
  WalletPrivacyError,
} from "../src/index.js";

const owner = "https://pod.example/profile#me";
const permissions = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@jeswr/pod-access/roles", () => ({
  readGrants: permissions.read,
  setGrants: permissions.write,
}));
const manager: RoleGrant = {
  agent: { type: "webid", id: owner },
  role: "manager",
  inherited: false,
  source: "acl",
};
const data = {
  name: "Test passport",
  kind: "passport" as const,
  created: new Date("2026-11-11"),
  modified: new Date("2026-11-11"),
};
function fixture(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol });
  const typeIndex = { register: vi.fn(async () => undefined) } as unknown as TypeIndex;
  const repository = createWalletRepository({ storage, fetch: vi.fn(), webId: owner, typeIndex });
  return { storage, typeIndex, repository };
}
beforeEach(() => {
  permissions.read.mockReset().mockResolvedValue({ grants: [manager], version: "v" });
  permissions.write.mockReset().mockResolvedValue({ applied: [], failed: [] });
});
it("recognises only unconstrained owner manager grants", () => {
  expect(ownerOnly([manager], owner)).toBe(true);
  for (const grants of [
    [],
    [{ ...manager, role: "viewer" as const }],
    [manager, { ...manager, agent: { type: "public" as const } }],
    [{ ...manager, purpose: "purpose" }],
    [{ ...manager, expiresAt: new Date() }],
    [{ ...manager, agent: { type: "webid" as const, id: "https://elsewhere.example/#me" } }],
  ])
    expect(ownerOnly(grants, owner)).toBe(false);
});
it("provisions empty folders through pod-access and registers only the private index", async () => {
  const { repository, typeIndex } = fixture();
  await repository.initialise();
  await repository.initialise();
  expect(permissions.write).toHaveBeenCalledTimes(4);
  expect(typeIndex.register).toHaveBeenCalledWith(
    "https://schema.org/DigitalDocument",
    { container: repository.base },
    { index: "private" },
  );
  expect(await repository.list()).toEqual([]);
});
it("refuses shared, unknown and unsupported access before records are written", async () => {
  const { repository } = fixture();
  permissions.read.mockResolvedValue({ grants: [] });
  await expect(repository.initialise()).rejects.toBeInstanceOf(WalletPrivacyError);
  const other = fixture();
  permissions.write.mockResolvedValue({ failed: [{}] });
  await expect(other.repository.initialise()).rejects.toBeInstanceOf(WalletPrivacyError);
  await expect(fixture("lws").repository.initialise()).rejects.toThrow(/Solid storage/);
});
it("propagates folder and access transport errors", async () => {
  const { storage, repository } = fixture();
  vi.spyOn(storage, "head").mockRejectedValueOnce(
    new StorageError("forbidden", { message: "no", method: "HEAD", url: repository.base }),
  );
  await expect(repository.initialise()).rejects.toThrow("no");
  permissions.read.mockRejectedValueOnce(new Error("unavailable"));
  await expect(repository.assertPrivate()).rejects.toThrow("unavailable");
});
it("creates, reads, conditionally updates and deletes independent records", async () => {
  const { repository } = fixture();
  await repository.initialise();
  const item = await repository.save(data);
  expect(item.etag).toBeTruthy();
  expect((await repository.list())[0]).toMatchObject(data);
  const updated = await repository.save({ ...item, name: "Updated" }, item);
  expect((await repository.read(updated.url)).name).toBe("Updated");
  await expect(repository.save(data, item)).rejects.toMatchObject({ code: "precondition-failed" });
  await expect(repository.save(data, { ...updated, etag: null })).rejects.toThrow(/version/);
  await expect(repository.remove({ ...updated, etag: null })).rejects.toThrow(/Reload/);
  await repository.remove(updated);
  expect(await repository.list()).toEqual([]);
});
it("rejects invalid metadata and non-wallet item addresses", async () => {
  const { storage, repository } = fixture();
  await repository.initialise();
  const file = await storage.create(repository.base, "", {
    name: "broken.ttl",
    contentType: "text/turtle",
  });
  await expect(repository.read(file.url)).rejects.toThrow(/invalid metadata/);
  for (const address of [
    "https://evil.example/a.ttl",
    repository.base,
    `${repository.files}a.ttl`,
    `${repository.base}a.ttl?query=1`,
    `${repository.base}a.ttl#it`,
    `${repository.base}a.json`,
  ]) {
    await expect(repository.read(address)).rejects.toThrow();
  }
});
it("refuses a new record that changed before its initial metadata write", async () => {
  const { storage, repository } = fixture();
  await repository.initialise();
  const realRead = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (url, options) => {
    const result = await realRead(url, options);
    return { ...result, etag: null };
  });
  await expect(repository.save(data)).rejects.toThrow(/changed before/);
});
it("accepts only bounded image and PDF attachments, scopes previews, and checks the response media type", async () => {
  const { storage, repository } = fixture();
  await repository.initialise();
  for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
    const url = await repository.upload(new Blob(["test"], { type }));
    expect(await (await repository.preview(url)).text()).toBe("test");
  }
  await expect(repository.upload(new Blob(["html"], { type: "text/html" }))).rejects.toThrow(
    /Choose/,
  );
  await expect(
    repository.upload(new Blob([new Uint8Array(10_485_761)], { type: "image/png" })),
  ).rejects.toThrow(/Choose/);
  await expect(repository.preview("https://evil.example/file")).rejects.toThrow();
  const html = await storage.create(repository.files, "x", { contentType: "image/svg+xml" });
  await expect(repository.preview(html.url)).rejects.toThrow(/safely/);
  const big = await storage.create(repository.files, new Uint8Array(10_485_761), {
    contentType: "image/png",
  });
  await expect(repository.preview(big.url)).rejects.toThrow(/10 MiB/);
  await expect(repository.credential("https://evil.example/vc.json")).rejects.toThrow();
  await expect(repository.storeCredential("{}")).rejects.toThrow();
});
describe("bounded original JSON reads", () => {
  it("handles empty, multibyte and chunked input with a strict byte budget", async () => {
    expect(await limitedText(null)).toBe("");
    const bytes = new TextEncoder().encode("£test");
    expect(
      await limitedText(
        new ReadableStream({
          start(c) {
            c.enqueue(bytes.slice(0, 1));
            c.enqueue(bytes.slice(1));
            c.close();
          },
        }),
        6,
      ),
    ).toBe("£test");
    await expect(limitedText(new Blob(["too big"]).stream(), 2)).rejects.toThrow(/large/);
    await expect(limitedText(new Blob([new Uint8Array([255])]).stream())).rejects.toThrow();
    await expect(
      limitedText(
        new ReadableStream({
          start(c) {
            c.error(new Error("stream failed"));
          },
        }),
      ),
    ).rejects.toThrow(/stream failed/);
  });
});

it("checks linked preferences and index access during real private registration", async () => {
  const storage = createMemoryStorage({ root: "https://pod.example/" });
  await storage.create(storage.root, "<#me> a <http://xmlns.com/foaf/0.1/Person> .", {
    name: "profile",
    contentType: "text/turtle",
  });
  const repository = createWalletRepository({ storage, fetch: vi.fn(), webId: owner });
  await repository.initialise();
  await repository.initialise();
  const { createTypeIndex } = await import("@jeswr/pod-type-index");
  const index = createTypeIndex({ storage, features: storage.features, profile: owner });
  await index.unregister(
    "https://schema.org/DigitalDocument",
    { container: repository.base },
    { index: "private" },
  );
  await repository.initialise();
  const write = vi.spyOn(storage, "writeRdf");
  permissions.read.mockImplementation(async (url: string) => ({
    grants: url.endsWith("privateTypeIndex.ttl")
      ? [{ ...manager, agent: { type: "public" } }]
      : [manager],
    version: "v",
  }));
  await expect(repository.initialise()).rejects.toBeInstanceOf(WalletPrivacyError);
  expect(write).not.toHaveBeenCalled();
});
it("handles a concurrent folder creator but rejects a server-assigned different location", async () => {
  const { repository, storage } = fixture();
  await repository.initialise();
  vi.spyOn(storage, "head").mockRejectedValueOnce(
    new StorageError("not-found", { method: "HEAD", url: repository.base, status: 404 }),
  );
  await repository.initialise();
  const assigned = fixture();
  const actualCreate = assigned.storage.create.bind(assigned.storage);
  vi.spyOn(assigned.storage, "create").mockImplementation(async (...args) => ({
    ...(await actualCreate(...args)),
    url: "https://pod.example/assigned/",
  }));
  await expect(assigned.repository.initialise()).rejects.toThrow(/unsupported wallet location/);
  const child = fixture();
  const childCreate = child.storage.create.bind(child.storage);
  vi.spyOn(child.storage, "create").mockImplementation(async (...args) => {
    const created = await childCreate(...args);
    return args[2]?.name === "files"
      ? { ...created, url: "https://pod.example/wallet/assigned/" }
      : created;
  });
  await expect(child.repository.initialise()).rejects.toThrow(/unsupported wallet folder/);
});
it("refuses invalid required metadata, ignores unrelated files and fails rather than truncating a large list", async () => {
  const { repository, storage } = fixture();
  await repository.initialise();
  await expect(repository.save({ ...data, name: "  " })).rejects.toThrow(/needs a name/);
  await storage.create(repository.base, "{}", {
    name: "unrelated.json",
    contentType: "application/json",
  });
  expect(await repository.list()).toEqual([]);
  await repository.save(data);
  const entries: Entry[] = [];
  for await (const entry of storage.listAll(repository.base))
    if (entry.url.endsWith(".ttl")) entries.push(entry);
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    for (let index = 0; index < 501; index++) yield entries[0] as NonNullable<(typeof entries)[0]>;
  });
  await expect(repository.list()).rejects.toThrow(/500 documents/);
});
it("reads bounded original credential bytes and permits an empty supported preview", async () => {
  const { repository, storage } = fixture();
  await repository.initialise();
  const { credentialToJsonLd, generateKeyPairForSuite, issue } = await import("@jeswr/solid-vc");
  const key = await generateKeyPairForSuite(`${owner}#key`, "Ed25519");
  const vc = await issue({ credential: { issuer: owner, credentialSubject: { id: owner } }, key });
  const source = `\n${JSON.stringify({ ...credentialToJsonLd(vc), proof: vc.proof })}\n`;
  const url = await repository.storeCredential(source);
  expect(await repository.credential(url)).toBe(source);
  const preview = await repository.upload(new Blob([], { type: "image/png" }));
  const actualRead = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
    ...(await actualRead(...args)),
    body: null,
  }));
  expect((await repository.preview(preview)).size).toBe(0);
});

it("refuses previews without a media type and cancels failed streams even when cancellation rejects", async () => {
  const { repository, storage } = fixture();
  await repository.initialise();
  const url = await repository.upload(new Blob(["x"], { type: "image/png" }));
  const read = storage.read.bind(storage);
  const spy = vi
    .spyOn(storage, "read")
    .mockImplementationOnce(async (...args) => ({ ...(await read(...args)), contentType: null }));
  await expect(repository.preview(url)).rejects.toThrow(/safely/);
  spy.mockImplementationOnce(async (...args) => ({
    ...(await read(...args)),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10_485_761));
      },
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    }),
  }));
  await expect(repository.preview(url)).rejects.toThrow(/10 MiB/);
  await expect(
    limitedText(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2));
        },
        cancel() {
          return Promise.reject(new Error("cancel failed"));
        },
      }),
      1,
    ),
  ).rejects.toThrow(/large/);
});

it("validates byte budgets and preserves a BOM in bounded reads", async () => {
  for (const limit of [-1, Infinity, NaN, 0.5])
    await expect(limitedText(null, limit)).rejects.toThrow(/byte limit/);
  expect(await limitedText(new Blob(["\uFEFF{}\n"]).stream())).toBe("\uFEFF{}\n");
  expect(await limitedText(new Blob([]).stream(), 0)).toBe("");
});
