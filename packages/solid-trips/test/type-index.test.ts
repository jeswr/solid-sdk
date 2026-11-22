// AUTHORED-BY Codex (GPT-6.1 Sol)
import { checkOwnerOnly } from "@jeswr/pod-access";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tripsTypeIndex } from "../src/type-index.js";

vi.mock("@jeswr/pod-access", () => ({ checkOwnerOnly: vi.fn() }));
const root = "https://pod.example/",
  owner = "https://identity.example/user#me",
  indexUrl = `${root}private/index`;
const solid = "http://www.w3.org/ns/solid/terms#";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkOwnerOnly).mockResolvedValue({ private: true });
});
async function fixture(preferences = false) {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { kind: "container", name: "private" });
  await storage.create(
    `${root}private/`,
    `<> a <${solid}TypeIndex> ; <http://schema.org/name> "Keep me" .`,
    { name: "index", contentType: "text/turtle" },
  );
  await storage.create(`${root}private/`, `<${owner}> <${solid}privateTypeIndex> <${indexUrl}> .`, {
    name: "prefs",
    contentType: "text/turtle",
  });
  const profile = preferences
    ? `<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}private/prefs> .`
    : `<${owner}> <${solid}privateTypeIndex> <${indexUrl}> .`;
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(profile, { headers: { "content-type": "text/turtle", etag: '"profile"' } }),
  );
  return { storage, fetch, ...tripsTypeIndex(storage, fetch, owner, false) };
}
describe("existing private Type Index integration", () => {
  it.each([
    false,
    true,
  ])("registers and discovers with an external WebID (preferences=%s) without writing shared settings/profile", async (preferences) => {
    const { storage, fetch, index, verifyPrivateIndex } = await fixture(preferences);
    const create = vi.spyOn(storage, "create"),
      write = vi.spyOn(storage, "writeRdf");
    await verifyPrivateIndex();
    await index.register(
      "http://schema.org/Trip",
      { container: `${root}trips/` },
      { index: "private" },
    );
    expect(await index.find("http://schema.org/Trip")).toEqual([`${root}trips/`]);
    expect(fetch).toHaveBeenCalledWith(
      "https://identity.example/user",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(indexUrl);
    expect(await (await storage.read(indexUrl)).text()).toContain("Keep me");
    expect(checkOwnerOnly).toHaveBeenCalledWith({ storage, url: indexUrl, ownerWebId: owner });
  });
  it("rechecks private index access just before persisting a registration", async () => {
    const { storage, index, verifyPrivateIndex } = await fixture();
    await verifyPrivateIndex();
    vi.mocked(checkOwnerOnly).mockResolvedValue({ private: false, reasons: [] });
    const before = await (await storage.read(indexUrl)).text();
    await expect(
      index.register("http://schema.org/Trip", { container: `${root}trips/` }),
    ).rejects.toThrow("already be owner-only");
    expect(await (await storage.read(indexUrl)).text()).toBe(before);
  });
  it("refuses missing index bootstrap without creating settings, even on helper retries", async () => {
    const { storage, fetch } = await fixture();
    fetch.mockImplementation(
      async () =>
        new Response(`<${owner}> <http://schema.org/name> "Example" .`, {
          headers: { "content-type": "text/turtle" },
        }),
    );
    const { index, verifyPrivateIndex } = tripsTypeIndex(storage, fetch, owner, false);
    await expect(verifyPrivateIndex()).rejects.toThrow("Set up a private Type Index");
    await expect(
      index.register("http://schema.org/Trip", { container: `${root}trips/` }),
    ).rejects.toThrow();
    await expect(storage.head(`${root}settings/`)).rejects.toMatchObject({ code: "not-found" });
  });
  it.each([
    "https://foreign.example/index",
    "https://foreign.example/../outside",
    "https://user:secret@pod.example/index",
  ])("refuses unsafe profile-linked data %s before access checks", async (target) => {
    const { storage, fetch } = await fixture();
    fetch.mockImplementation(
      async () =>
        new Response(`<${owner}> <${solid}privateTypeIndex> <${target}> .`, {
          headers: { "content-type": "text/turtle" },
        }),
    );
    await expect(
      tripsTypeIndex(storage, fetch, owner, false).verifyPrivateIndex(),
    ).rejects.toThrow();
    expect(checkOwnerOnly).not.toHaveBeenCalled();
  });
  it.each([
    "javascript:alert(1)",
    "https://user:secret@identity.example/me",
  ])("refuses unsafe identity %s", async (value) => {
    const { storage, fetch } = await fixture();
    expect(() => tripsTypeIndex(storage, fetch, value, false)).toThrow("Invalid WebID");
  });
  it("propagates profile and preferences failures and bypasses verification only for explicit demo", async () => {
    const { storage, fetch } = await fixture(true);
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(
      tripsTypeIndex(storage, fetch, owner, false).verifyPrivateIndex(),
    ).rejects.toThrow();
    await tripsTypeIndex(storage, fetch, owner, true).verifyPrivateIndex();
    expect(checkOwnerOnly).not.toHaveBeenCalled();
    const read = storage.readRdf;
    storage.readRdf = async () => {
      throw new Error("preferences denied");
    };
    await expect(tripsTypeIndex(storage, fetch, owner, false).verifyPrivateIndex()).rejects.toThrow(
      "preferences denied",
    );
    storage.readRdf = read;
  });
});
