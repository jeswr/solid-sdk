// AUTHORED-BY Claude Sonnet 5.5
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { createTemplateStore, TEMPLATE_CLASS, TemplateAccessError } from "../src/index.js";

const root = "https://pod.example/alice/";
const profile = `${root}profile#me`;
const factory = vi.hoisted(() => ({
  failure: undefined as unknown,
  index: undefined as unknown,
}));
vi.mock("@jeswr/pod-type-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/pod-type-index")>();
  return {
    ...actual,
    createTypeIndex: (...args: Parameters<typeof actual.createTypeIndex>) => {
      if (factory.failure) throw factory.failure;
      return factory.index ?? actual.createTypeIndex(...args);
    },
  };
});
const metadata = {
  name: "Meeting",
  description: "For teams",
  app: "docs" as const,
  category: "Work",
  previewText: "Agenda",
  author: `${root}profile#me`,
};
const input = { metadata, content: () => ({ body: "<p>Agenda</p>", contentType: "text/html" }) };
function fakeIndex(register: TypeIndex["register"]) {
  const fake = { find: vi.fn(async () => []), register: vi.fn(register) };
  factory.index = fake;
  return fake;
}

describe.each(["solid", "lws"] as const)("%s Type Index registration", (protocol) => {
  const pod = () => createMemoryStorage({ root, protocol });
  it("a failed registration is reported but never blocks saving, listing or reading", async () => {
    const index = fakeIndex(async () => {
      throw new StorageError("forbidden", { method: "PUT", url: root, message: "secret" });
    });
    const failures: string[] = [];
    const store = createTemplateStore({
      storage: pod(),
      profile,
      ensurePrivateAccess: async () => true,
      onRegistrationError: (reason) => failures.push(reason),
    });
    expect(store.registration).toEqual({ state: "pending" });
    const saved = await store.save(input);
    expect(saved.data.name).toBe("Meeting");
    expect(store.registration).toEqual({ state: "failed", reason: "forbidden" });
    expect(failures).toEqual(["forbidden"]);
    expect((await store.list()).map((entry) => entry.data.name)).toEqual(["Meeting"]);
    expect((await store.content(saved)).body).toBe("<p>Agenda</p>");
    // The private index is the only target: no second argument can select a public one.
    expect(index.register).toHaveBeenCalledWith(TEMPLATE_CLASS, {
      container: `${root}templates/`,
    });
    for (const call of index.register.mock.calls) expect(call).toHaveLength(2);
    // Retrying recovers, and a non-StorageError keeps only a generic reason.
    index.register.mockRejectedValueOnce(new Error("secret"));
    expect(await store.retryRegistration()).toEqual({ state: "failed", reason: "unknown" });
    expect(JSON.stringify(store.registration)).not.toContain("secret");
    index.register.mockImplementation(async () => undefined);
    expect(await store.retryRegistration()).toEqual({ state: "registered" });
  });
  it("still verifies owner-only access before any content write when registration failed", async () => {
    fakeIndex(async () => {
      throw new StorageError("forbidden", { method: "PUT", url: root });
    });
    const storage = pod();
    const create = vi.spyOn(storage, "create");
    const ensurePrivateAccess = vi.fn(async () => false);
    const store = createTemplateStore({ storage, profile, ensurePrivateAccess });
    await expect(store.save(input)).rejects.toBeInstanceOf(TemplateAccessError);
    expect(ensurePrivateAccess).toHaveBeenCalledWith(`${root}templates/`, { created: true });
    // Only the collection itself was created: no content, asset or metadata resource.
    expect(create.mock.calls.map(([, , options]) => options?.kind ?? "resource")).toEqual([
      "container",
    ]);
    expect(await store.list()).toEqual([]);
  });
  it("retrying registration before a collection exists neither creates nor registers anything", async () => {
    const index = fakeIndex(async () => undefined);
    const storage = pod();
    const create = vi.spyOn(storage, "create");
    const store = createTemplateStore({
      storage,
      profile,
      ensurePrivateAccess: async () => true,
    });
    expect(await store.retryRegistration()).toEqual({ state: "pending" });
    expect(create).not.toHaveBeenCalled();
    expect(index.register).not.toHaveBeenCalled();
  });
});
describe("a store without a registrable profile", () => {
  it("works with no profile and reports registration as unavailable", async () => {
    factory.index = undefined;
    const store = createTemplateStore({
      storage: createMemoryStorage({ root, protocol: "solid" }),
      ensurePrivateAccess: async () => true,
    });
    expect(store.registration).toEqual({ state: "unavailable" });
    await store.save(input);
    expect(await store.retryRegistration()).toEqual({ state: "unavailable" });
    expect(await store.list()).toHaveLength(1);
  });
  it("opens, saves and lists when the Solid WebID is outside the storage", async () => {
    factory.index = undefined;
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const store = createTemplateStore({
      storage,
      profile: "https://id.example/card#me",
      ensurePrivateAccess: async () => true,
    });
    expect(store.registration).toEqual({ state: "unavailable" });
    await store.save(input);
    expect(store.registration).toEqual({ state: "unavailable" });
    expect(await store.list()).toHaveLength(1);
  });
  it("rethrows constructor failures that are not a scope error", () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const make = () =>
      createTemplateStore({ storage, profile, ensurePrivateAccess: async () => true });
    factory.failure = new StorageError("forbidden", { method: "GET", url: root });
    expect(make).toThrow(StorageError);
    factory.failure = new TypeError("broken");
    expect(make).toThrow("broken");
    factory.failure = undefined;
  });
});
