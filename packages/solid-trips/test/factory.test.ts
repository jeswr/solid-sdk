// AUTHORED-BY Codex (GPT-6.1 Sol)
import { checkOwnerOnly } from "@jeswr/pod-access";
import { setGrants } from "@jeswr/pod-access/roles";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { openTripsStore } from "../src/index.js";

vi.mock("@jeswr/pod-access", () => ({ checkOwnerOnly: vi.fn() }));
vi.mock("@jeswr/pod-access/roles", () => ({ setGrants: vi.fn() }));
vi.mock("@jeswr/pod-type-index", () => ({ createTypeIndex: vi.fn() }));
vi.mock("@jeswr/storage-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
const root = "https://pod.example/",
  owner = `${root}card#me`;
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
  vi.resetAllMocks();
});
async function fixture(
  profile = `<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}private/prefs> ; <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}private/legacy> .`,
) {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { name: "private", kind: "container" });
  await storage.create(
    `${root}private/`,
    `<${owner}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}private/index> .`,
    { name: "prefs", contentType: "text/turtle" },
  );
  fetch.mockImplementation(
    async () => new Response(profile, { headers: { "Content-Type": "text/turtle" } }),
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
  vi.mocked(checkOwnerOnly).mockResolvedValue({ private: true });
  return { storage, register };
}
it("only changes access on Trips folders and verifies shared private documents read-only", async () => {
  const { storage, register } = await fixture();
  const store = await openTripsStore(fetch, root, owner);
  await store.initialise();
  expect(vi.mocked(setGrants).mock.calls.flatMap((call) => call[0])).toEqual([
    `${root}trips/`,
    `${root}trips/reservations/`,
  ]);
  expect(vi.mocked(checkOwnerOnly).mock.calls.map((call) => call[0].url)).toEqual(
    expect.arrayContaining([
      `${root}private/prefs`,
      `${root}private/index`,
      `${root}private/legacy`,
    ]),
  );
  await expect(storage.head(`${root}settings/`)).rejects.toMatchObject({ code: "not-found" });
  expect(register).toHaveBeenCalledOnce();
  expect(checkOwnerOnly).toHaveBeenCalledWith({ storage, url: `${root}trips/`, ownerWebId: owner });
});
it("refuses personal writes when provisioning fails, without treating roles as privacy proof", async () => {
  const { register } = await fixture();
  vi.mocked(setGrants).mockResolvedValue({
    applied: [],
    failed: [{ url: root, error: new Error("No Control") }],
    notification: { requested: false, delivered: false },
  });
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow(
    "owner-only",
  );
  expect(checkOwnerOnly).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});
it.each([
  "non-owner",
  "unknown",
  "unrepresentable",
  "unsupported-model",
] as const)("fails closed on helper refusal: %s", async (reason) => {
  const { register } = await fixture();
  vi.mocked(checkOwnerOnly).mockResolvedValue({
    private: false,
    reasons: [{ subject: "unknown", modes: [], reason }],
  });
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow(
    "verify owner-only",
  );
  expect(register).not.toHaveBeenCalled();
});
it("propagates helper and access transport failures before writing private data", async () => {
  const { register } = await fixture();
  vi.mocked(checkOwnerOnly).mockRejectedValue(new Error("access unavailable"));
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow(
    "access unavailable",
  );
  expect(register).not.toHaveBeenCalled();
});
it.each([
  `${root}private/prefs`,
  `${root}private/index`,
  `${root}private/legacy`,
])("does not repair a shared document that fails privacy verification: %s", async (url) => {
  const { register } = await fixture();
  vi.mocked(checkOwnerOnly).mockImplementation(async (options) =>
    options.url === url ? { private: false, reasons: [] } : { private: true },
  );
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow(
    "already be owner-only",
  );
  expect(register).not.toHaveBeenCalled();
  expect(vi.mocked(setGrants).mock.calls.flatMap((call) => call[0])).not.toContain(url);
});
it("refuses unlinked and off-storage preferences without creating settings", async () => {
  const { storage } = await fixture(`<${owner}> <http://schema.org/name> "Example" .`);
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow(
    "Set up a private Type Index",
  );
  await expect(storage.head(`${root}settings/`)).rejects.toMatchObject({ code: "not-found" });
  fetch.mockClear();
  const { register } = await fixture(
    `<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <https://foreign.example/prefs> .`,
  );
  await expect((await openTripsStore(fetch, root, owner)).initialise()).rejects.toThrow();
  expect(register).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reads an external identity profile using session fetch and only verifies pod documents", async () => {
  await fixture();
  const identity = "https://id.example/user#me";
  fetch.mockResolvedValue(
    new Response(
      `<${identity}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}private/index> .`,
      { headers: { "Content-Type": "text/turtle" } },
    ),
  );
  const store = await openTripsStore(fetch, root, identity);
  await store.initialise();
  expect(fetch).toHaveBeenCalledWith(
    "https://id.example/user",
    expect.objectContaining({ redirect: "error" }),
  );
});
it("propagates storage discovery failure", async () => {
  vi.mocked(createPodClient).mockRejectedValue(new Error("No description"));
  await expect(openTripsStore(fetch, root, owner)).rejects.toThrow("No description");
  expect(setGrants).not.toHaveBeenCalled();
});
it("checks privacy for new trip and booking documents, failing before their content writes", async () => {
  const { storage } = await fixture();
  const store = await openTripsStore(fetch, root, owner);
  await store.initialise();
  vi.mocked(checkOwnerOnly).mockImplementation(async ({ url }) =>
    url.endsWith("/") ? { private: true } : { private: false, reasons: [] },
  );
  const write = vi.spyOn(storage, "write");
  await expect(store.addReservation({ kind: "FlightReservation" })).rejects.toThrow(
    "verify owner-only",
  );
  await expect(
    store.saveTrip({
      id: "pending:new",
      name: "Example",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      reservations: [],
    }),
  ).rejects.toThrow("verify owner-only");
  expect(write).not.toHaveBeenCalled();
});
