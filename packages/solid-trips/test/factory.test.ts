// AUTHORED-BY Codex (GPT-6.1 Sol)
import { readGrants, setGrants } from "@jeswr/pod-access/roles";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { openTripsStore } from "../src/index.js";

vi.mock("@jeswr/pod-access/roles", () => ({ setGrants: vi.fn(), readGrants: vi.fn() }));
vi.mock("@jeswr/pod-type-index", () => ({ createTypeIndex: vi.fn() }));
vi.mock("@jeswr/storage-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
const root = "https://pod.example/",
  owner = `${root}card#me`;
const fetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
});
async function fixture(
  profile = `<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}private/prefs> ; <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}private/legacy> .`,
) {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { name: "private", kind: "container" });
  await storage.create(root, profile, { name: "card", contentType: "text/turtle" });
  await storage.create(
    `${root}private/`,
    `<${owner}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}private/index> .`,
    { name: "prefs", contentType: "text/turtle" },
  );
  vi.mocked(createPodClient).mockResolvedValue({ storage, features: storage.features } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  const register = vi.fn(async () => undefined);
  vi.mocked(createTypeIndex).mockReturnValue({
    register,
    findAll: vi.fn(),
  } as unknown as ReturnType<typeof createTypeIndex>);
  vi.mocked(setGrants).mockResolvedValue({
    applied: [],
    failed: [],
    notification: { requested: false, delivered: false },
  });
  vi.mocked(readGrants).mockResolvedValue({
    url: root,
    version: "fixture" as never,
    grants: [
      { agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" },
    ],
  });
  return { storage, register };
}
it("provisions actual linked private documents as well as Trips folders before registration", async () => {
  const { register } = await fixture();
  const store = await openTripsStore(fetch, root, owner);
  await store.initialise();
  const protectedUrls = vi.mocked(setGrants).mock.calls.flatMap((call) => call[0]);
  expect(protectedUrls).toEqual(
    expect.arrayContaining([
      `${root}trips/`,
      `${root}trips/reservations/`,
      `${root}settings/`,
      `${root}private/prefs`,
      `${root}private/index`,
      `${root}private/legacy`,
    ]),
  );
  expect(register).toHaveBeenCalledOnce();
  for (const call of vi.mocked(setGrants).mock.calls)
    expect(call[1]).toEqual([
      { agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" },
    ]);
});
it("refuses personal writes when owner-only provisioning fails", async () => {
  const { register } = await fixture();
  vi.mocked(setGrants).mockResolvedValue({
    applied: [],
    failed: [{ url: root, error: new Error("No Control") }],
    notification: { requested: false, delivered: false },
  });
  const store = await openTripsStore(fetch, root, owner);
  await expect(store.initialise()).rejects.toThrow("owner-only");
  expect(register).not.toHaveBeenCalled();
});
it("handles an unlinked profile and refuses off-storage preferences", async () => {
  await fixture(`<${owner}> <http://schema.org/name> "Example" .`);
  await (await openTripsStore(fetch, root, owner)).initialise();
  const { register } = await fixture(
    `<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <https://foreign.example/prefs> .`,
  );
  const store = await openTripsStore(fetch, root, owner);
  await expect(store.initialise()).rejects.toThrow();
  expect(register).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("propagates discovery failures without selecting a backend", async () => {
  vi.mocked(createPodClient).mockRejectedValue(new Error("No description"));
  await expect(openTripsStore(fetch, root, owner)).rejects.toThrow("No description");
  expect(setGrants).not.toHaveBeenCalled();
});

it("refuses inherited public access even after an own owner-only rule is written", async () => {
  const { register } = await fixture();
  vi.mocked(readGrants).mockResolvedValue({
    url: root,
    version: "fixture" as never,
    grants: [{ agent: { type: "public" }, role: "viewer", inherited: true, source: root }],
  });
  const store = await openTripsStore(fetch, root, owner);
  await expect(store.initialise()).rejects.toThrow("inherited access");
  expect(register).not.toHaveBeenCalled();
});
