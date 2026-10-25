// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { test } from "vitest";
import { GoogleTokenSource, MsalTokenSource, OAuthBearerTokenProvider } from "../src/mod.js";

const signal = () => new AbortController().signal;
function google() {
  return {
    config: undefined,
    initTokenClient(config) {
      this.config = config;
      return { requestAccessToken() {} };
    },
    hasGrantedAllScopes: () => true,
    revoke(_token, callback) {
      callback({ successful: false });
    },
  };
}

test("Google rejects empty scopes and aborted UI, and exposes a working interaction action", async () => {
  const sdk = google();
  assert.throws(() => new GoogleTokenSource(sdk, { clientId: "c", scopes: [] }), /scope/);
  const source = new GoogleTokenSource(sdk, { clientId: "c", scopes: ["s"], revokeOnForget: true });
  const controller = new AbortController();
  controller.abort(new Error("aborted"));
  await assert.rejects(source.authorize(controller.signal), /aborted/);
  let interaction;
  await assert.rejects(source.getAccessToken({ signal: signal() }), (error) => {
    interaction = error;
    return error.name === "InteractionRequiredError";
  });
  const pending = interaction.authorize();
  sdk.config.callback({
    access_token: "token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "s",
  });
  assert.equal((await pending).token, "token");
  await assert.rejects(source.forget(), (error) => error.code === "revocation_failed");
  const denied = source.authorize();
  const check = assert.rejects(denied, /Google authorization failed: access_denied/);
  sdk.config.callback({ error: "access_denied" });
  await check;
});

test("MSAL validates scopes and carries explicit authority and UI hints into requests", async () => {
  const account = { homeAccountId: "alice", username: "alice" };
  const requests = [];
  let selected = null;
  const result = () => ({ accessToken: "token", account, scopes: ["s"], expiresOn: null });
  const sdk = {
    getActiveAccount: () => selected,
    acquireTokenPopup: async (options) => {
      requests.push(options);
      selected = account;
      return result();
    },
    acquireTokenSilent: async (options) => {
      requests.push(options);
      return result();
    },
  };
  assert.throws(() => new MsalTokenSource(sdk, { scopes: [] }), /scope/);
  const source = new MsalTokenSource(sdk, {
    scopes: ["s"],
    authority: "https://issuer.example/tenant",
    prompt: "select_account",
    loginHint: "alice",
  });
  let interaction;
  await assert.rejects(source.getAccessToken({ signal: signal() }), (error) => {
    interaction = error;
    return error.name === "InteractionRequiredError";
  });
  assert.deepEqual(await interaction.authorize(), { token: "token" });
  assert.deepEqual(requests[0], {
    scopes: ["s"],
    authority: "https://issuer.example/tenant",
    prompt: "select_account",
    loginHint: "alice",
  });
  assert.deepEqual(await source.getAccessToken({ signal: signal() }), { token: "token" });
  assert.equal(requests[1].authority, "https://issuer.example/tenant");
  // With no selected or returned account, a structurally valid result remains usable for this call.
  const anonymous = new MsalTokenSource(
    {
      ...sdk,
      getActiveAccount: () => null,
      acquireTokenPopup: async () => ({ ...result(), account: null }),
    },
    { scopes: ["s"] },
  );
  assert.deepEqual(await anonymous.authorize(), { token: "token" });
  const failure = new Error("popup could not start");
  const broken = new MsalTokenSource(
    {
      ...sdk,
      acquireTokenPopup() {
        throw failure;
      },
    },
    { scopes: ["s"] },
  );
  await assert.rejects(broken.authorize(), (error) => error === failure);
  // A synchronous SDK failure releases the shared interaction lock.
  await assert.rejects(broken.authorize(), (error) => error === failure);
});

test("Bearer providers renew expired credentials, reject repeated failures, and preserve newer rejections", async () => {
  assert.throws(() => new OAuthBearerTokenProvider({}, { resources: [] }), /at least one resource/);
  const request = new Request("https://api.example/resource");
  let tokens = [{ token: "expired", expiresAt: 0 }, { token: "fresh" }];
  const source = { id: "api", getAccessToken: async () => tokens.shift() };
  const provider = new OAuthBearerTokenProvider(source, { resources: ["https://api.example/"] });
  assert.equal(await provider.matches(request), true);
  await provider.invalidate(request);
  assert.equal((await provider.upgrade(request)).headers.get("authorization"), "Bearer fresh");
  tokens = [
    { token: "bad", expiresAt: 0 },
    { token: "still-bad", expiresAt: 0 },
  ];
  await assert.rejects(provider.upgrade(request), /expired or rejected/);
  const gate = Promise.withResolvers();
  const readStarted = Promise.withResolvers();
  source.getAccessToken = async () => {
    readStarted.resolve();
    return gate.promise;
  };
  const pending = provider.upgrade(request);
  await readStarted.promise;
  await provider.invalidate(new Request(request, { headers: { authorization: "Bearer other" } }));
  gate.resolve({ token: "fresh" });
  assert.equal((await pending).headers.get("authorization"), "Bearer fresh");
  source.getAccessToken = async (options) => {
    assert.equal(options.rejectedToken, "other");
    return { token: "replacement" };
  };
  assert.equal(
    (await provider.upgrade(request)).headers.get("authorization"),
    "Bearer replacement",
  );
});
