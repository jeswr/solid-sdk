// AUTHORED-BY Codex GPT-6
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { ENTRY_CLASS, JournalPrivacyError } from "../src/index.js";
import { privateJournalIndex } from "../src/registration.js";

const root = "https://pod.example/";
const settings = `${root}settings/`;
const preferences = `${settings}prefs.ttl`;
const indexUrl = `${settings}privateTypeIndex.ttl`;
const journal = `${root}journal/`;
const turtle = "text/turtle";

async function fixture(privateRoot = true) {
  const profile = `${root}profile.ttl`;
  const owner = `${profile}#me`;
  const memory = createMemoryStorage({ root, protocol: "solid" });
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", evidence: "fixture", detail: { model: "wac" } },
    },
    async head(url, options) {
      const result = await memory.head(url, options);
      const links = new Map(result.links);
      links.set("acl", [{ target: `${url}.acl`, params: {} }]);
      return { ...result, links };
    },
  };
  async function setAccess(url: string, isPrivate: boolean) {
    const policy = ownerPolicy(owner, url.endsWith("/"));
    if (!isPrivate) {
      const grant = policy.grants[0];
      if (!grant) throw new Error("Expected an owner grant");
      policy.grants.push({ ...grant, modes: new Set(["read"]), who: [[{ kind: "public" }]] });
    }
    const acl = `${url}.acl`;
    await storage.write(acl, await writeWac(policy, url, acl), {
      contentType: turtle,
      ifMatch: "*",
    });
  }
  await storage.write(profile, "", { contentType: turtle, ifMatch: "*" });
  await setAccess(root, privateRoot);
  const guarded = privateJournalIndex(storage, owner);
  const index = createTypeIndex({ storage: guarded, features: guarded.features, profile: owner });
  return { storage, guarded, index, owner, profile, setAccess };
}

it("bootstraps private settings and publishes only the preferences link on a public profile", async () => {
  const { storage, index, profile, setAccess } = await fixture();
  await setAccess(profile, false);
  const create = vi.spyOn(storage, "create");
  const read = vi.spyOn(storage, "read");
  const head = vi.spyOn(storage, "head");
  await index.register(ENTRY_CLASS, { container: journal }, { index: "private" });
  expect(create.mock.calls.map(([parent, , options]) => [parent, options])).toEqual([
    [root, expect.objectContaining({ kind: "container", name: "settings" })],
    [settings, expect.objectContaining({ exactUrl: indexUrl, signal: expect.any(AbortSignal) })],
    [settings, expect.objectContaining({ exactUrl: preferences, signal: expect.any(AbortSignal) })],
  ]);
  expect(create.mock.calls[0]?.[1]).toBeNull();
  expect(create.mock.calls.slice(1).every(([, , options]) => options?.name === undefined)).toBe(
    true,
  );
  expect(head).toHaveBeenCalledWith(settings, {
    revalidate: true,
    signal: expect.any(AbortSignal),
  });
  expect(read).toHaveBeenCalledWith(
    `${root}.acl`,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    }),
  );
  const publicCard = await (await storage.read(profile)).text();
  expect(publicCard).toContain(preferences);
  expect(publicCard).not.toContain(indexUrl);
  expect(publicCard).not.toContain(journal);
  expect(await index.find(ENTRY_CLASS)).toEqual([journal]);

  const second = `${root}other-journal/`;
  const write = vi.spyOn(storage, "writeRdf");
  await index.register(ENTRY_CLASS, { container: second }, { index: "private" });
  expect(write).toHaveBeenCalledExactlyOnceWith(
    indexUrl,
    expect.anything(),
    expect.objectContaining({ ifMatch: expect.any(String), signal: expect.any(AbortSignal) }),
  );
  expect(await index.find(ENTRY_CLASS)).toEqual([journal, second]);
});

it("refuses to bootstrap missing settings from shared root access", async () => {
  const { storage, index, profile } = await fixture(false);
  const create = vi.spyOn(storage, "create");
  const write = vi.spyOn(storage, "writeRdf");
  const read = vi.spyOn(storage, "readRdf");
  await expect(
    index.register(ENTRY_CLASS, { container: journal }, { index: "private" }),
  ).rejects.toThrow(JournalPrivacyError);
  expect(read).toHaveBeenCalledExactlyOnceWith(profile, expect.anything());
  expect(create).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("preserves failed settings metadata as the cause and refuses to create other folders", async () => {
  const { storage, guarded } = await fixture();
  const create = vi.spyOn(storage, "create");
  const read = vi.spyOn(storage, "readRdf");
  const head = storage.head;
  const denied = new StorageError("forbidden", { url: settings, method: "HEAD", status: 403 });
  vi.spyOn(storage, "head").mockImplementation(async (url, options) => {
    if (url === settings) throw denied;
    return head(url, options);
  });
  await expect(guarded.readRdf(preferences)).rejects.toMatchObject({ cause: denied });
  await expect(guarded.readRdf(`${root}archive/prefs.ttl`)).rejects.toThrow(JournalPrivacyError);
  expect(read).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("applies private ACL checks to a profile aliased by a private preferences pointer", async () => {
  const { storage, guarded, index, profile, setAccess } = await fixture();
  await index.register(ENTRY_CLASS, { container: journal }, { index: "private" });
  const body = await (await storage.read(profile)).text();
  await storage.write(profile, body.replace(`<${preferences}>`, `<${profile}#alias>`), {
    ifMatch: "*",
    contentType: turtle,
  });
  const { dataset, etag } = await guarded.readRdf(profile);
  await expect(
    guarded.writeRdf(profile, dataset, { ifMatch: etag ?? "missing", contentType: turtle }),
  ).resolves.toMatchObject({ url: profile });

  await setAccess(profile, false);
  const write = vi.spyOn(storage, "writeRdf");
  await expect(guarded.writeRdf(profile, dataset, { ifMatch: "*" })).rejects.toThrow(
    JournalPrivacyError,
  );
  await expect(guarded.readRdf(profile)).rejects.toThrow(JournalPrivacyError);
  expect(write).not.toHaveBeenCalled();
});

it("leaves malformed profile pointers for the Type Index to reject before any writes", async () => {
  const { storage, guarded, index, owner, profile } = await fixture();
  await index.register(ENTRY_CLASS, { container: journal }, { index: "private" });
  const body = await (await storage.read(profile)).text();
  // Corrupt the SDK's serialized pointer to exercise malformed RDF arriving from the pod.
  for (const [replacement, termType] of [
    ['"not an IRI"', "Literal"],
    ["<https://[>", "NamedNode"],
  ] as const) {
    await storage.write(profile, body.replace(`<${preferences}>`, replacement), {
      ifMatch: "*",
      contentType: turtle,
    });
    const { dataset } = await guarded.readRdf(profile);
    const pointer = dataset.match(
      DataFactory.namedNode(owner),
      DataFactory.namedNode("http://www.w3.org/ns/pim/space#preferencesFile"),
    );
    expect([...pointer].map(({ object }) => object.termType)).toEqual([termType]);
    const create = vi.spyOn(storage, "create");
    const write = vi.spyOn(storage, "writeRdf");
    await expect(
      index.register(ENTRY_CLASS, { container: journal }, { index: "private" }),
    ).rejects.toMatchObject({ code: "scope" });
    expect(create).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  }
});

it("refuses unverified container creates and resource creates without a name", async () => {
  const { storage, guarded } = await fixture();
  const create = vi.spyOn(storage, "create");
  const folder = { kind: "container", name: "settings" } as const;
  await expect(guarded.create(root, null, { ...folder, name: "other" })).rejects.toThrow(
    JournalPrivacyError,
  );
  await expect(guarded.create(settings, null, folder)).rejects.toThrow(JournalPrivacyError);
  await expect(guarded.create(root, "private content", folder)).rejects.toThrow(
    JournalPrivacyError,
  );
  await expect(guarded.create(root, "private content", { contentType: turtle })).rejects.toThrow(
    JournalPrivacyError,
  );
  expect(create).not.toHaveBeenCalled();
});
