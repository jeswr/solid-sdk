// AUTHORED-BY Claude Opus 5.5
import { createPodAuth } from "@jeswr/pod-auth";
import { createMemoryStore, createMockOp } from "@jeswr/pod-auth/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SolidBackend } from "../src/shell/session/solid-backend";
import { SignInError } from "../src/shell/session/types";

// The shell session backend over the real pod-auth engine and its mock OP, with shared storage
// standing in for two tabs of one browser profile.
beforeEach(() => {
  // The mock OP's callback is this origin's /auth/callback.html, which the backend derives.
  vi.stubGlobal("location", new URL("https://app.example/"));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function engine() {
  const op = createMockOp({ refreshTokens: true, revocation: true });
  vi.stubGlobal("fetch", op.fetch);
  const storage = { sessions: createMemoryStore(), caches: createMemoryStore() };
  const tab = (getCode: typeof op.getCode = op.getCode) =>
    new SolidBackend({
      createAuth: (options) =>
        createPodAuth({
          ...options,
          clientId: op.clientId,
          storage,
          boundary: { roots: [op.root], automatic: false },
        }),
      resolveTarget: async (input) =>
        input === op.issuer ? { kind: "issuer", issuer: input } : { kind: "webid", webId: input },
      publicFetch: op.fetch,
      isNativeApp: () => false,
      openPopup: () => ({ getCode, close: () => {} }),
    });
  if (!op.webId) throw new Error("The mock OP issues a WebID by default");
  return { op, tab, webId: op.webId };
}

it("recovers an account whose refresh persistently fails with invalid_client", async () => {
  const { op, tab, webId } = engine();
  const first = await tab().signIn({ webId });
  op.failRefresh("invalid_client");
  const reloaded = tab();
  expect(await reloaded.restore()).toBeNull();
  // A provider hint still cannot name the remembered account.
  await expect(reloaded.signIn({ issuer: op.issuer })).rejects.toEqual(
    new SignInError("session-elsewhere"),
  );
  const authorizations = op.stats.authorizations;
  const account = await reloaded.signIn({ webId });
  expect(account).toMatchObject({ id: first.id, webId, storageUrl: op.root });
  expect(op.stats.authorizations).toBe(authorizations + 1);
  expect((await reloaded.fetchFor(account)(`${op.root}private`)).status).toBe(200);
  op.failRefresh();
  expect(await tab().restore()).toMatchObject({ webId });
});

it("refuses to overwrite a sign-in another tab committed while this tab's popup was open", async () => {
  const { op, tab, webId } = engine();
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const slow = tab(async (url, signal) => {
    opened.resolve();
    await release.promise;
    return await op.getCode(url, signal);
  });
  const signingIn = slow.signIn({ webId });
  const failure = expect(signingIn).rejects.toEqual(new SignInError("session-elsewhere"));
  await opened.promise;
  const other = tab();
  const account = await other.signIn({ issuer: op.issuer });
  release.resolve();
  await failure;
  // The other tab's session, owner and pointer survive; a reload restores its grant.
  expect((await other.fetchFor(account)(`${op.root}private`)).status).toBe(200);
  expect(op.stats.revocations).toBe(0);
  expect(await tab().restore()).toMatchObject({ webId: account.webId });
  expect(await other.signOut(account)).toBeUndefined();
  expect(await tab().restore()).toBeNull();
});
