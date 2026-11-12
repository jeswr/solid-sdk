// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-6.1 Sol
import { Agent } from "@solid/object";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyCredentials,
  consumeAutologinAccount,
  deriveSession,
  readProfile,
} from "../src/index";
import { deferred, fakePodAuth, identity, WEB_ID } from "../src/testing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("legacy credentials", () => {
  it("removes only configured keys, continuing after individual failures in every store", () => {
    const deleteDatabase = vi.fn().mockImplementationOnce(() => {
      throw new Error("denied");
    });
    const localRemove = vi.fn().mockImplementationOnce(() => {
      throw new Error("denied");
    });
    const sessionRemove = vi.fn().mockImplementationOnce(() => {
      throw new Error("denied");
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });
    vi.stubGlobal("localStorage", { removeItem: localRemove });
    vi.stubGlobal("sessionStorage", { removeItem: sessionRemove });
    clearLegacyCredentials({
      indexedDb: ["old", "older"],
      localStorage: ["old", "older"],
      sessionStorage: ["old", "older"],
    });
    for (const remove of [deleteDatabase, localRemove, sessionRemove])
      expect(remove.mock.calls).toEqual([["old"], ["older"]]);
  });

  it("tolerates absent stores and denied storage getters", () => {
    for (const name of ["indexedDB", "localStorage", "sessionStorage"] as const)
      vi.stubGlobal(name, undefined);
    clearLegacyCredentials({ indexedDb: ["old"], localStorage: ["old"], sessionStorage: ["old"] });
    for (const name of ["indexedDB", "localStorage", "sessionStorage"] as const)
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error("denied");
        },
      });
    expect(() =>
      clearLegacyCredentials({
        indexedDb: ["old"],
        localStorage: ["old"],
        sessionStorage: ["old"],
      }),
    ).not.toThrow();
  });
});

it("reads a minimal public profile without a display name or photo", async () => {
  // The accessor's null name is unusual but part of its documented nullable contract.
  vi.spyOn(Agent.prototype, "name", "get").mockReturnValue(null);
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response("", { headers: { "content-type": "text/turtle" } }),
  );
  expect(await readProfile(WEB_ID, fetch)).toEqual({
    webId: WEB_ID,
    name: WEB_ID,
    avatarUrl: undefined,
    storages: [],
    oidcIssuers: [],
  });
  expect(fetch).toHaveBeenCalled();
});

it("normalizes a storage root without a slash and omits a missing display name", () => {
  expect(
    deriveSession({
      webId: WEB_ID,
      name: "",
      storages: ["https://storage.example/alice"],
      oidcIssuers: [],
    }),
  ).toMatchObject({
    podRoot: "https://storage.example/alice/",
    displayName: undefined,
    podRootIsFallback: false,
  });
});

it.each([
  ["https://alice.example/with space#me", false, null],
  ["http://localhost/profile#me", true, "http://localhost/profile#me"],
  ["http://remote.example/profile#me", true, null],
  ["https://:secret@alice.example/#me", false, null],
])("consumes the account suggestion safely: %s", (webId, dev, expected) => {
  vi.stubGlobal("location", new URL(`http://localhost/#autologin/${encodeURIComponent(webId)}`));
  const replace = vi.spyOn(history, "replaceState").mockImplementation(() => {});
  expect(consumeAutologinAccount(dev)).toBe(expected);
  expect(replace).toHaveBeenCalledWith(history.state, "", "http://localhost/");
});

it("the public testing helper supports subscriptions, empty events, transport and identity seams", async () => {
  const fake = fakePodAuth();
  fake.emit("challenge", null);
  const first = vi.fn();
  const second = vi.fn();
  const stop = fake.auth.on("login", first);
  const stopSecond = fake.auth.on("login", second);
  expect(await fake.auth.login()).toEqual(identity);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  stop();
  stop();
  stopSecond();
  fake.emit("login", identity);
  expect(first).toHaveBeenCalledTimes(1);
  expect(await fake.auth.identity()).toBeNull();
  expect(await (await fake.auth.fetch("https://storage.example/")).text()).toBe("private files");
  // Account-pinned reads use the same transport mock as the default fetch.
  const pinned = fake.auth.fetchFor({ webId: WEB_ID, issuer: identity.issuer });
  expect(pinned).toBe(fake.auth.fetch);
  expect(await (await pinned("https://storage.example/")).text()).toBe("private files");
  const pending = deferred<void>();
  pending.resolve();
  await expect(pending.promise).resolves.toBeUndefined();
});
