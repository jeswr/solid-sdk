// Google Identity Services and MSAL.js are exercised through their documented external contracts with
// in-process fakes (no live Google/Microsoft registrations): callbacks, error callbacks, partial grants,
// silent-first with forceRefresh, interaction-required errors and late results.
import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, test, vi } from "vitest";
import {
  AuthorizationFailedError,
  CredentialBoundary,
  GoogleTokenSource,
  InteractionRequiredError,
  MsalTokenSource,
  OAuthBearerTokenProvider,
  ReactiveFetchManager,
  SessionSupersededError,
} from "../src/mod.js";
import { serve, transport } from "./helpers/http.js";

/** A fake `google.accounts.oauth2`: requestAccessToken records the call; the test decides the outcome. */
function fakeGoogle() {
  const google = {
    requests: [],
    configs: [],
    revoked: [],
    initTokenClient(config) {
      google.configs.push(config);
      return { requestAccessToken: (overrides) => google.requests.push({ config, overrides }) };
    },
    grant(response) {
      google.configs.at(-1).callback(response);
    },
    fail(type) {
      google.configs.at(-1).error_callback({ type });
    },
    hasGrantedAllScopes(response, ...scopes) {
      return scopes.every((s) => (response.scope ?? "").split(" ").includes(s));
    },
    revoke(token) {
      google.revoked.push(token);
    },
  };
  return google;
}

let api, valid;
before(async () => {
  valid = new Set();
  api = await serve((request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    return valid.has(token)
      ? new Response("ok")
      : new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'Bearer error="invalid_token"' },
        });
  });
});
after(() => api.close());

function managerFor(source) {
  const resources = new CredentialBoundary([`${api.url}/`], { allowInsecureHttp: true });
  return new ReactiveFetchManager({
    providers: [new OAuthBearerTokenProvider(source, { resources })],
    boundary: resources,
    fetch: transport,
  });
}

const scope = "https://www.googleapis.com/auth/drive.readonly";

test("Google: authorize requests the token synchronously (user gesture), then reactive requests reuse it", async () => {
  const google = fakeGoogle();
  const needed = [];
  const source = new GoogleTokenSource(google, {
    clientId: "web-client",
    scopes: [scope],
    prompt: "consent",
    onInteractionRequired: (s) => needed.push(s),
  });
  const manager = managerFor(source);

  // Before any token: the reactive path does not open a popup; it asks the application for a click.
  await assert.rejects(
    manager.fetch(`${api.url}/files`),
    (e) => e instanceof InteractionRequiredError && typeof e.authorize === "function",
  );
  assert.equal(needed.length, 1);
  assert.equal(google.requests.length, 0);

  const authorizing = source.authorize();
  assert.equal(
    google.requests.length,
    1,
    "requestAccessToken was called before authorize() returned",
  );
  assert.equal(google.requests[0].overrides.prompt, "consent");
  valid.add("g-1");
  google.grant({ access_token: "g-1", expires_in: 3599, scope, token_type: "Bearer" });
  assert.equal((await authorizing).token, "g-1");
  assert.equal((await manager.fetch(`${api.url}/files`)).status, 200);
});

test("Google: partial grants, OAuth errors and popup failures are typed; late callbacks are ignored", async () => {
  const google = fakeGoogle();
  const source = new GoogleTokenSource(google, {
    clientId: "c",
    scopes: [scope, "https://www.googleapis.com/auth/calendar.readonly"],
  });

  const partial = source.authorize();
  google.grant({ access_token: "g-partial", expires_in: 3599, scope, token_type: "Bearer" });
  await assert.rejects(
    partial,
    (e) => e instanceof AuthorizationFailedError && e.code === "partial_grant",
  );

  const denied = source.authorize();
  google.grant({ error: "access_denied", error_description: "denied" });
  await assert.rejects(denied, (e) => e.code === "access_denied");

  const closed = source.authorize();
  google.fail("popup_closed");
  await assert.rejects(closed, (e) => e.code === "popup_closed");

  const pending = source.authorize();
  await source.forget();
  await assert.rejects(pending, SessionSupersededError);
  google.grant({
    access_token: "g-late",
    expires_in: 3599,
    scope: `${scope} https://www.googleapis.com/auth/calendar.readonly`,
    token_type: "Bearer",
  });
  await assert.rejects(
    source.getAccessToken({ signal: new AbortController().signal }),
    InteractionRequiredError,
    "the late token was not kept",
  );
});

test("Google: an expired or rejected token needs a new user-gesture authorization; no refresh token exists", async () => {
  const google = fakeGoogle();
  const source = new GoogleTokenSource(google, {
    clientId: "c",
    scopes: [scope],
    revokeOnForget: true,
  });
  const authorizing = source.authorize();
  google.grant({ access_token: "g-2", expires_in: 3599, scope, token_type: "Bearer" });
  await authorizing;
  const signal = new AbortController().signal;
  assert.equal((await source.getAccessToken({ signal })).token, "g-2");
  await assert.rejects(
    source.getAccessToken({ signal, rejectedToken: "g-2" }),
    InteractionRequiredError,
  );

  const again = source.authorize();
  assert.equal(
    google.requests.at(-1).overrides.prompt,
    undefined,
    "later renewals do not force consent",
  );
  google.grant({ access_token: "g-3", expires_in: 30, scope, token_type: "Bearer" }); // within the one-minute skew
  await again;
  await assert.rejects(
    source.getAccessToken({ signal }),
    InteractionRequiredError,
    "near expiry counts as expired",
  );
  await source.forget();
});

test("review: each Google authorization owns its callbacks; overlapping, aborted, failing and malformed requests settle", async () => {
  const google = fakeGoogle();
  const source = new GoogleTokenSource(google, {
    clientId: "c",
    scopes: [scope],
    loginHint: "alice@example.com",
  });
  assert.equal(google.configs.length, 0, "no SDK client until an authorization starts");

  const first = source.authorize();
  const firstConfig = google.configs.at(-1);
  assert.equal(firstConfig.login_hint, "alice@example.com");
  await assert.rejects(
    source.authorize(),
    (e) => e.code === "interaction_in_progress",
    "no second popup while one is open",
  );
  await source.forget();
  await assert.rejects(first, SessionSupersededError);

  const second = source.authorize();
  firstConfig.callback({ access_token: "g-stale", expires_in: 3599, scope, token_type: "Bearer" }); // old SDK callback
  firstConfig.error_callback({ type: "popup_closed" }); // old error callback
  google.grant({ access_token: "g-fresh", expires_in: 3599, scope, token_type: "Bearer" });
  assert.equal((await second).token, "g-fresh");

  const controller = new AbortController();
  const aborted = source.authorize(controller.signal);
  const abortedConfig = google.configs.at(-1);
  controller.abort(new Error("navigated away"));
  await assert.rejects(aborted, /navigated away/);
  abortedConfig.callback({
    access_token: "g-after-abort",
    expires_in: 3599,
    scope,
    token_type: "Bearer",
  });
  assert.equal(
    (await source.getAccessToken({ signal: new AbortController().signal })).token,
    "g-fresh",
  );

  for (const response of [
    { access_token: "x", scope, token_type: "Bearer" },
    { access_token: "x", expires_in: 3599, scope, token_type: "mac" },
    { access_token: "", expires_in: 3599, scope, token_type: "Bearer" },
  ]) {
    const malformed = source.authorize();
    google.grant(response);
    await assert.rejects(
      malformed,
      (e) => e.code === "invalid_token_response",
      JSON.stringify(response),
    );
  }

  const throwing = new GoogleTokenSource(
    {
      ...google,
      initTokenClient: () => ({
        requestAccessToken() {
          throw new Error("blocked");
        },
      }),
    },
    { clientId: "c", scopes: [scope] },
  );
  await assert.rejects(throwing.authorize(), (e) => e.code === "sdk_error");
  await assert.rejects(
    throwing.authorize(),
    (e) => e.code === "sdk_error",
    "a synchronous failure does not leave an operation pending",
  );
});

/** A fake MSAL client: scripted results per call, recording requests. */
function fakeMsal(script) {
  return {
    silent: [],
    popups: [],
    active: null,
    async acquireTokenSilent(request) {
      this.silent.push(request);
      return await script.silent(request);
    },
    async acquireTokenPopup(request) {
      this.popups.push(request);
      return await script.popup(request);
    },
    getActiveAccount() {
      return this.active;
    },
  };
}

const alice = { homeAccountId: "alice.tenant", username: "alice@contoso.example" };
const result = (token, account = alice) => ({
  accessToken: token,
  expiresOn: new Date(Date.now() + 3600_000),
  account,
  scopes: ["User.Read"],
});

test("MSAL: silent first, forceRefresh after rejection, interaction only for interaction-required errors", async () => {
  let n = 0;
  const msal = fakeMsal({
    silent: async () => result(`m-${++n}`),
    popup: async () => result("m-popup"),
  });
  const source = new MsalTokenSource(msal, { scopes: ["User.Read"] });
  const manager = managerFor(source);

  // No account yet: interaction required; MSAL's cache is not searched for an arbitrary first account.
  await assert.rejects(manager.fetch(`${api.url}/me`), InteractionRequiredError);
  assert.equal(msal.silent.length, 0);

  valid.add("m-popup");
  assert.equal((await source.authorize()).token, "m-popup");
  assert.equal(msal.popups[0].scopes[0], "User.Read");

  valid.add("m-2");
  assert.equal((await manager.fetch(`${api.url}/me`)).status, 200); // m-1 rejected by the API → forceRefresh → m-2
  assert.equal(msal.silent[0].forceRefresh, undefined);
  assert.equal(msal.silent[1].forceRefresh, true);
  assert.equal(msal.silent[1].account, alice, "the authorized account, not a guess");
});

test("MSAL: interaction-required becomes InteractionRequiredError; other errors propagate; late results are ignored", async () => {
  const interaction = Object.assign(new Error("AADSTS50076"), {
    name: "InteractionRequiredAuthError",
    errorCode: "interaction_required",
  });
  const network = Object.assign(new Error("offline"), {
    name: "BrowserAuthError",
    errorCode: "network_error",
  });
  let next;
  const msal = fakeMsal({
    silent: async () => {
      if (next instanceof Error) throw next;
      return await next;
    },
    popup: async () => result("p"),
  });
  msal.active = alice;
  const needed = [];
  const source = new MsalTokenSource(msal, {
    scopes: ["User.Read"],
    onInteractionRequired: (s) => needed.push(s),
  });
  const signal = new AbortController().signal;

  next = interaction;
  await assert.rejects(
    source.getAccessToken({ signal }),
    (e) => e instanceof InteractionRequiredError && e.cause === interaction,
  );
  assert.equal(needed.length, 1);
  next = network;
  await assert.rejects(
    source.getAccessToken({ signal }),
    (e) => e === network,
    "unrelated failures are not masked",
  );

  const late = Promise.withResolvers();
  next = late.promise;
  const pending = source.getAccessToken({ signal });
  await source.forget();
  late.resolve(result("m-late"));
  await assert.rejects(pending, SessionSupersededError);

  const scoped = new MsalTokenSource(msal, {
    scopes: ["api://contoso-api/read"],
    authority: "https://login.microsoftonline.com/contoso.example",
  });
  assert.notEqual(scoped.id, source.id, "one source per resource and authority");
});

test("review: MSAL honours the account selector, rejects stale or mismatched results and settles promptly", async () => {
  const bob = { homeAccountId: "bob.tenant", username: "bob@contoso.example" };
  let selected = alice;
  let reply = async () => result("m-a");
  const msal = fakeMsal({
    silent: async (request) => await reply(request),
    popup: async () => result("m-p"),
  });
  msal.active = bob;
  const source = new MsalTokenSource(msal, { scopes: ["User.Read"], account: () => selected });
  const signal = new AbortController().signal;

  selected = null;
  await assert.rejects(
    source.getAccessToken({ signal }),
    InteractionRequiredError,
    "an explicit no-account selection is authoritative",
  );
  assert.equal(msal.silent.length, 0);

  selected = alice;
  assert.equal((await source.getAccessToken({ signal })).token, "m-a");
  assert.equal(
    msal.silent.at(-1).account,
    alice,
    "the selected account, not MSAL's active account",
  );
  await source.getAccessToken({ signal, rejectedToken: "some-other-token" });
  assert.equal(
    msal.silent.at(-1).forceRefresh,
    undefined,
    "forceRefresh only for the token this source handed out",
  );

  reply = async () => result("m-b", bob);
  await assert.rejects(source.getAccessToken({ signal }), /different account/);
  reply = async () => ({ ...result("m-x"), expiresOn: new Date(Number.NaN) });
  await assert.rejects(source.getAccessToken({ signal }), /invalid expiry/);
  reply = async () => ({ ...result(""), accessToken: "" });
  await assert.rejects(source.getAccessToken({ signal }), /no access token/);

  const slow = Promise.withResolvers();
  reply = () => slow.promise;
  const switching = source.getAccessToken({ signal });
  selected = bob;
  slow.resolve(result("m-alice-late"));
  await assert.rejects(switching, SessionSupersededError, "account switched during acquisition");
  selected = alice;

  const needed = [];
  const never = new MsalTokenSource(
    fakeMsal({ silent: () => new Promise(() => {}), popup: () => new Promise(() => {}) }),
    { scopes: ["User.Read"], account: () => alice, onInteractionRequired: (s) => needed.push(s) },
  );
  const controller = new AbortController();
  const waiting = never.getAccessToken({ signal: controller.signal });
  controller.abort(new Error("caller cancelled"));
  await assert.rejects(waiting, /caller cancelled/, "settles without waiting for the SDK");
  assert.equal(needed.length, 0);

  const popup = never.authorize();
  await assert.rejects(never.authorize(), (e) => e.code === "interaction_in_progress");
  await never.forget();
  await assert.rejects(popup, SessionSupersededError);
});

test("final: MSAL results that win the race just before logout are discarded; popups honour the selector; sync throws free the SDK", async () => {
  const msal = fakeMsal({
    silent: () => Promise.resolve(result("m-raced")),
    popup: () => Promise.resolve(result("m-popup-raced")),
  });
  const source = new MsalTokenSource(msal, { scopes: ["User.Read"] });
  msal.active = alice;
  const silent = source.getAccessToken({ signal: new AbortController().signal });
  void source.forget(); // aborts synchronously, before the awaiting continuation runs
  await assert.rejects(silent, SessionSupersededError);
  await source.getAccessToken({ signal: new AbortController().signal, rejectedToken: "m-raced" });
  assert.equal(
    msal.silent.at(-1).forceRefresh,
    undefined,
    "the discarded token never became this source's last token",
  );

  msal.active = null;
  const popup = source.authorize();
  void source.forget();
  await assert.rejects(popup, SessionSupersededError);
  await assert.rejects(
    source.getAccessToken({ signal: new AbortController().signal }),
    InteractionRequiredError,
    "no account was restored from the discarded popup result",
  );

  const bob = { homeAccountId: "bob.tenant", username: "bob@contoso.example" };
  let selected = alice;
  const slowPopup = Promise.withResolvers();
  const selecting = new MsalTokenSource(
    fakeMsal({ silent: async () => result("s"), popup: () => slowPopup.promise }),
    { scopes: ["User.Read"], account: () => selected },
  );
  const switching = selecting.authorize();
  selected = bob;
  slowPopup.resolve(result("m-alice"));
  await assert.rejects(switching, SessionSupersededError, "selector changed during the popup");

  let throwOnce = true;
  const shared = fakeMsal({
    silent: async () => result("s"),
    popup: () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("popup blocked");
      }
      return Promise.resolve(result("m-ok"));
    },
  });
  const first = new MsalTokenSource(shared, { scopes: ["User.Read"] });
  await assert.rejects(first.authorize(), /popup blocked/);
  assert.equal(
    (await new MsalTokenSource(shared, { scopes: ["Mail.Read"] }).authorize()).token,
    "m-ok",
    "the SDK is not left marked busy",
  );
});

test("final: Google revocation reports its outcome after local logout", async () => {
  const outcomes = [
    { successful: true },
    { successful: false, error: "invalid_token" },
    { successful: false, error: "server_error", error_description: "try later" },
  ];
  for (const outcome of outcomes) {
    const google = { ...fakeGoogle(), revoked: [] };
    google.revoke = (token, done) => {
      google.revoked.push(token);
      setTimeout(() => done(outcome), 1);
    };
    const source = new GoogleTokenSource(google, {
      clientId: "c",
      scopes: [scope],
      revokeOnForget: true,
    });
    const authorizing = source.authorize();
    google.configs
      .at(-1)
      .callback({ access_token: "g-rev", expires_in: 3599, scope, token_type: "Bearer" });
    await authorizing;
    const forgetting = source.forget();
    await assert.rejects(
      source.getAccessToken({ signal: new AbortController().signal }),
      InteractionRequiredError,
      "local state cleared first",
    );
    if (outcome.error === "server_error")
      await assert.rejects(forgetting, (e) => e.code === "server_error");
    else await forgetting;
    assert.deepEqual(google.revoked, ["g-rev"]);
  }

  const withoutRevoke = fakeGoogle();
  delete withoutRevoke.revoke;
  const source = new GoogleTokenSource(withoutRevoke, {
    clientId: "c",
    scopes: [scope],
    revokeOnForget: true,
  });
  const authorizing = source.authorize();
  withoutRevoke.configs
    .at(-1)
    .callback({ access_token: "g-x", expires_in: 3599, scope, token_type: "Bearer" });
  await authorizing;
  await assert.rejects(source.forget(), (e) => e.code === "revocation_unavailable");

  const api = await import("../src/mod.js");
  assert.equal("abortable" in api, false, "internal helper is not public API");
});

test("final: a synchronously throwing Google revoke rejects forget without leaving a timer or local state", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const google = fakeGoogle();
  google.revoke = () => {
    throw new Error("sdk not ready");
  };
  const source = new GoogleTokenSource(google, {
    clientId: "c",
    scopes: [scope],
    revokeOnForget: true,
  });
  const authorizing = source.authorize();
  google.configs
    .at(-1)
    .callback({ access_token: "g-t", expires_in: 3599, scope, token_type: "Bearer" });
  await authorizing;
  await assert.rejects(source.forget(), (e) => e.code === "revocation_failed");
  vi.advanceTimersByTime(20_000); // a leftover timeout would now reject an abandoned promise
  await assert.rejects(
    source.getAccessToken({ signal: new AbortController().signal }),
    InteractionRequiredError,
  );
});
