// AUTHORED-BY Claude Sonnet 5.5
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { newDeck } from "../src/deck.js";
import { createDeckRepository } from "../src/repository.js";

const root = "https://pod.example/";
const factory = vi.hoisted(() => ({ failure: undefined as unknown }));
vi.mock("@jeswr/pod-type-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/pod-type-index")>();
  return {
    ...actual,
    createTypeIndex: (...args: Parameters<typeof actual.createTypeIndex>) => {
      if (factory.failure) throw factory.failure;
      return actual.createTypeIndex(...args);
    },
  };
});

describe.each(["solid", "lws"] as const)("%s Type Index registration", (protocol) => {
  const storage = () => createMemoryStorage({ root, protocol });
  const profile = `${root}profile/card#me`;
  it("a failed registration is a recoverable state; the collection stays readable and writable", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new StorageError("forbidden", { method: "PUT", url: root }))
      .mockRejectedValueOnce(new Error("secret detail that must not be kept"))
      .mockResolvedValue(undefined);
    const repo = createDeckRepository(storage(), {
      profile,
      index: { register } as unknown as TypeIndex,
    });
    expect(repo.registration).toEqual({ state: "pending" });
    await repo.initialise();
    expect(repo.registration).toEqual({ state: "failed", reason: "forbidden" });
    const created = await repo.create(newDeck("Still works", new Date(0)));
    expect((await repo.list()).decks.map((entry) => entry.deck.name)).toEqual(["Still works"]);
    await repo.save(created, { ...created.deck, name: "Edited" });
    // Only the error code is kept, never its message.
    expect(await repo.register()).toEqual({ state: "failed", reason: "unknown" });
    expect(JSON.stringify(repo.registration)).not.toContain("secret");
    // Retrying (explicitly or through initialise) recovers.
    expect(await repo.register()).toEqual({ state: "registered" });
    await repo.initialise();
    expect(repo.registration).toEqual({ state: "registered" });
    // The container stays registered through the same call as before, without a public index.
    expect(register).toHaveBeenLastCalledWith("http://schema.org/PresentationDigitalDocument", {
      container: repo.container,
    });
  });
  it("opens when the WebID profile is outside the storage", async () => {
    const pod = storage();
    const repo = createDeckRepository(pod, { profile: "https://id.example/card#me" });
    // Only Solid scopes a Type Index to the storage; LWS registers through the storage service.
    const state = protocol === "solid" ? "unavailable" : "pending";
    expect(repo.registration).toEqual({ state });
    await repo.initialise();
    expect(await repo.register()).toEqual({
      state: protocol === "solid" ? "unavailable" : "registered",
    });
    expect(repo.registration.state).toBe(protocol === "solid" ? "unavailable" : "registered");
    const created = await repo.create(newDeck("Outside", new Date(0)));
    expect((await repo.list()).decks).toHaveLength(1);
    await repo.remove(created);
    await expect(pod.head(`${root}settings/`)).rejects.toMatchObject({ code: "not-found" });
  });
  it("registers through a real Type Index when the profile is in the storage", async () => {
    const pod = storage();
    await pod.create(root, null, { name: "profile", kind: "container" });
    await pod.create(`${root}profile/`, "<#me> a <http://xmlns.com/foaf/0.1/Person> .", {
      name: "card",
      contentType: "text/turtle",
    });
    const repo = createDeckRepository(pod, { profile });
    await repo.initialise();
    expect(repo.registration).toEqual({ state: "registered" });
    expect((await repo.list()).decks).toEqual([]);
  });
});
it("rethrows constructor failures that are not a scope error", () => {
  const pod = createMemoryStorage({ root });
  factory.failure = new StorageError("forbidden", { method: "GET", url: root });
  expect(() => createDeckRepository(pod, { profile: `${root}profile/card#me` })).toThrow(
    StorageError,
  );
  factory.failure = new TypeError("broken");
  expect(() => createDeckRepository(pod, { profile: `${root}profile/card#me` })).toThrow("broken");
  factory.failure = new StorageError("scope", { method: "GET", url: root });
  expect(createDeckRepository(pod, { profile: `${root}profile/card#me` }).registration).toEqual({
    state: "unavailable",
  });
  factory.failure = undefined;
});
