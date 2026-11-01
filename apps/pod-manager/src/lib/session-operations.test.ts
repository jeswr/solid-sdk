// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { SessionOperations } from "./session-operations";
import { loginProfile, WebIdIssuerAuthorityError } from "./session-identity";
import type { WebIdDPoPTokenProvider } from "./webid-token-provider";
import type { PodProfile } from "./profile";

const ALICE = "https://pod.test/alice#me";
const BOB = "https://pod.test/bob#me";
const ISSUER = "https://as.test/";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  let identity = ALICE;
  const provider = {
    login: vi.fn<WebIdDPoPTokenProvider["login"]>(async () => ({ webId: identity, ownership: 0 })),
    restoreIssuer: vi.fn<WebIdDPoPTokenProvider["restoreIssuer"]>(async () => ({ webId: ALICE, ownership: 0 })),
    forgetIssuer: vi.fn(async () => {}),
    forgetIssuerIfOwned: vi.fn(async () => {}),
  };
  const effects = {
    provider: vi.fn(async () => provider),
    currentProvider: () => provider,
    openPopup: vi.fn(), closePopup: vi.fn(), authenticating: vi.fn(),
    seedIdentity: vi.fn(), publish: vi.fn(), failed: vi.fn(), loggedOut: vi.fn(),
    loadProfile: vi.fn<typeof loginProfile>(async (webId: string) => ({ webId, storages: [] }) as unknown as PodProfile),
    resolveInput: vi.fn<(input: string) => Promise<import("./login-input").LoginTarget>>(async () => ({ kind: "issuer" as const, issuer: ISSUER })),
  };
  return { provider, effects, operations: new SessionOperations(effects), bob: () => { identity = BOB; } };
}

describe("session operation publication ownership", () => {
  it.each(["login", "restore"] as const)("late %s profile success cannot publish Alice over Bob", async (kind) => {
    const { operations, effects, provider, bob } = harness();
    const arrived = deferred<void>();
    const held = deferred<PodProfile>();
    effects.loadProfile.mockImplementationOnce(() => { arrived.resolve(); return held.promise; });
    const alice = kind === "login" ? operations.loginWithIssuer(ISSUER) : operations.restore(ALICE, ISSUER);
    await arrived.promise;
    await operations.logout();
    expect(provider.forgetIssuer).toHaveBeenCalledWith(new URL(ISSUER));
    bob();
    await operations.loginWithIssuer(ISSUER);
    const closes = effects.closePopup.mock.calls.length;
    held.resolve({ webId: ALICE, storages: [] } as unknown as PodProfile);
    await alice;
    expect(effects.publish).toHaveBeenCalledOnce();
    expect(effects.publish.mock.calls[0][0]).toBe(BOB);
    expect(effects.closePopup).toHaveBeenCalledTimes(closes);
    expect(effects.failed).not.toHaveBeenCalled();
  });

  it.each(["login", "restore"] as const)("late %s profile failure cannot reset Bob or close his popup", async (kind) => {
    const { operations, effects, bob } = harness();
    const arrived = deferred<void>();
    const held = deferred<PodProfile>();
    effects.loadProfile.mockImplementationOnce(() => { arrived.resolve(); return held.promise; });
    const alice = kind === "login" ? operations.loginWithIssuer(ISSUER) : operations.restore(ALICE, ISSUER);
    await arrived.promise;
    bob();
    await operations.loginWithIssuer(ISSUER);
    const closes = effects.closePopup.mock.calls.length;
    held.reject(new Error("offline"));
    await alice;
    expect(effects.publish).toHaveBeenCalledOnce();
    expect(effects.publish.mock.calls[0][0]).toBe(BOB);
    expect(effects.closePopup).toHaveBeenCalledTimes(closes);
    expect(effects.failed).not.toHaveBeenCalled();
  });

  it("logout fences input resolution before it can authenticate or close another popup", async () => {
    const { operations, effects, provider } = harness();
    const held = deferred<{ kind: "issuer"; issuer: string }>();
    effects.resolveInput.mockReturnValueOnce(held.promise);
    const login = operations.login(ALICE);
    await operations.logout();
    held.resolve({ kind: "issuer", issuer: ISSUER });
    await login;
    expect(provider.login).not.toHaveBeenCalled();
    expect(effects.closePopup).not.toHaveBeenCalled();
    expect(effects.publish).not.toHaveBeenCalled();
  });

  it("reload validation receives the restored identity and its exact ownership", async () => {
    const { operations, effects, provider } = harness();
    provider.restoreIssuer.mockResolvedValueOnce({ webId: BOB, ownership: 7 });
    await operations.restore(ALICE, ISSUER);
    expect(effects.loadProfile.mock.calls[0].slice(0, 4)).toEqual([BOB, ISSUER, 7, provider]);
    expect(effects.publish.mock.calls[0][0]).toBe(BOB);
  });
});


it.each(["matching login", "reload"] as const)("%s rejects a profile that removed the remembered issuer", async (kind) => {
  const { operations, effects, provider } = harness();
  effects.resolveInput.mockResolvedValueOnce({ kind: "webid", webId: ALICE, issuers: [ISSUER], displayName: "Alice" });
  const arrived = deferred<void>();
  const held = deferred<void>();
  effects.loadProfile.mockImplementation((id, issuer, ownership, owner, _fetch, current) =>
    loginProfile(id, issuer, ownership, owner, async () => {
      arrived.resolve();
      await held.promise;
      return new Response(`<${ALICE}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://unrelated.test/> .`, {
        headers: { "content-type": "text/turtle" },
      });
    }, current));
  const attempt = (kind === "reload" ? operations.restore(ALICE, ISSUER) : operations.login(ALICE, { issuer: ISSUER }))
    .catch((error: unknown) => error);
  await arrived.promise;
  expect(effects.publish).not.toHaveBeenCalled();
  held.resolve();
  expect(await attempt).toBeInstanceOf(WebIdIssuerAuthorityError);
  expect(effects.publish).not.toHaveBeenCalled();
  expect(provider.forgetIssuerIfOwned).toHaveBeenCalledWith(new URL(ISSUER), 0);
});

it.each([
  ["provider", "success"], ["provider", "failure"],
  ["grant", "success"], ["grant", "failure"],
] as const)("logout fences a late %s %s before profile or popup effects", async (stage, outcome) => {
  const { operations, effects, provider } = harness();
  const arrived = deferred<void>();
  const held = deferred<void>();
  if (stage === "provider") effects.provider.mockImplementationOnce(async () => {
    arrived.resolve(); await held.promise; return provider;
  });
  else provider.login.mockImplementationOnce(async () => {
    arrived.resolve(); await held.promise; return { webId: ALICE, ownership: 0 };
  });
  const login = operations.loginWithIssuer(ISSUER);
  await arrived.promise;
  await operations.logout();
  if (outcome === "success") held.resolve();
  else held.reject(new Error("offline"));
  await login;
  expect(effects.closePopup).not.toHaveBeenCalled();
  expect(effects.loadProfile).not.toHaveBeenCalled();
  expect(effects.publish).not.toHaveBeenCalled();
  expect(effects.failed).not.toHaveBeenCalled();
});


it("logout forgets a remembered issuer while restore awaits provider initialization", async () => {
  const { operations, effects, provider } = harness();
  const arrived = deferred<void>();
  const ready = deferred<typeof provider>();
  effects.provider.mockImplementationOnce(() => { arrived.resolve(); return ready.promise; });
  const restore = operations.restore(ALICE, ISSUER);
  await arrived.promise;
  await operations.logout();
  ready.resolve(provider);
  await restore;
  expect(provider.forgetIssuer).toHaveBeenCalledWith(new URL(ISSUER));
  expect(provider.restoreIssuer).not.toHaveBeenCalled();
  expect(effects.publish).not.toHaveBeenCalled();
});

it("logout at profile settlement cannot be followed by stale publication", async () => {
  const { operations, effects } = harness();
  const arrived = deferred<void>();
  const held = deferred<PodProfile>();
  let published: string | undefined;
  effects.publish.mockImplementation((id) => { published = id; });
  effects.loggedOut.mockImplementation(() => { published = undefined; });
  effects.loadProfile.mockImplementationOnce(() => { arrived.resolve(); return held.promise; });
  const login = operations.loginWithIssuer(ISSUER);
  await arrived.promise;
  const logout = held.promise.then(() => operations.logout());
  held.resolve({ webId: ALICE, storages: [] } as unknown as PodProfile);
  await Promise.all([login, logout]);
  expect(published).toBeUndefined();
});
