// Harness-level tests of the browser-SDK adapters (Google Identity Services, MSAL.js): configuration
// validation, manifest entries, missing-configuration reporting, the loopback page/decoy servers, error-fact
// allowlisting. Offline and browser-free (npm test); the real-browser regressions (cancellation unwinding,
// session-mode fail-closed) are test/browser/sdk-regressions.test.js, and the wiring check is interop/browser/wiring.js.
import assert from "node:assert/strict";
import { test } from "vitest";
import * as google from "../interop/adapters/google.js";
import { adapterFor, selected } from "../interop/adapters/index.js";
import * as msal from "../interop/adapters/msal.js";
import { pageFailure } from "../interop/browser/driver.js";
import { errorFacts } from "../interop/browser/errors.js";
import { corsDecoy, pageOriginProblem, startPageServer } from "../interop/browser/server.js";
import { loadManifest, resolveTarget } from "../interop/lib/manifest.js";
import { redact } from "../interop/lib/redact.js";
import { Report, UNTESTED } from "../interop/lib/report.js";
import { Cleanups, runSelection } from "../interop/lib/runner.js";
import { runScenarios } from "../interop/lib/scenario.js";

const manifest = await loadManifest();
const byId = (id) => manifest.targets.find((t) => t.id === id);

const googleEnv = {
  RA_INTEROP_GOOGLE_CLIENT_ID: "123456789012-abcdefghijklmnop.apps.googleusercontent.com",
  RA_INTEROP_GOOGLE_EXPECTED_EMAIL: "interop-google@example.test",
};
const msalEnv = {
  RA_INTEROP_MSAL_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
  RA_INTEROP_MSAL_EXPECTED_UPN: "interop-msal@contoso.example",
};

test("the browser-SDK targets are live, manual-login and list their adapters' scenarios", () => {
  for (const [id, adapter, module] of [
    ["google-gis", "google-gis", google],
    ["microsoft-msal", "msal-browser", msal],
  ]) {
    const t = byId(id);
    assert.equal(t.adapter, adapter);
    assert.equal(t.category, "live");
    const { config } = resolveTarget(t, id === "google-gis" ? googleEnv : msalEnv);
    assert.deepEqual(module.validate(config), [], id);
    assert.equal(config.login.recipe, "manual");
    assert.equal(config.storageState, undefined, "an unset storageState variable leaves no path");
  }
});

test("unconfigured browser-SDK targets report the missing variables by name, and only the required ones", () => {
  assert.deepEqual(resolveTarget(byId("google-gis"), {}).missing, [
    "RA_INTEROP_GOOGLE_CLIENT_ID",
    "RA_INTEROP_GOOGLE_EXPECTED_EMAIL",
  ]);
  assert.deepEqual(resolveTarget(byId("microsoft-msal"), {}).missing, [
    "RA_INTEROP_MSAL_CLIENT_ID",
    "RA_INTEROP_MSAL_EXPECTED_UPN",
  ]);
  // The expected test account is required: a client ID alone does not make the committed targets runnable.
  assert.deepEqual(
    resolveTarget(byId("google-gis"), {
      RA_INTEROP_GOOGLE_CLIENT_ID: googleEnv.RA_INTEROP_GOOGLE_CLIENT_ID,
    }).missing,
    ["RA_INTEROP_GOOGLE_EXPECTED_EMAIL"],
  );
  const { config } = resolveTarget(byId("microsoft-msal"), msalEnv);
  assert.equal(config.authority, "https://login.microsoftonline.com/organizations");
  assert.equal(config.origin, "http://localhost:39441");
});

test("expected identities are registered for redaction and only compared", () => {
  const upn = "interop-test-user@contoso.example";
  const { config } = resolveTarget(byId("microsoft-msal"), {
    ...msalEnv,
    RA_INTEROP_MSAL_EXPECTED_UPN: upn,
  });
  assert.equal(config.api.identity.expected, upn);
  assert.equal(redact(`mentioning ${upn}`), "mentioning [sensitive]");
});

test("the runner records every browser-SDK scenario UNTESTED when not configured (no adapter code runs)", async () => {
  const report = new Report({});
  const targets = [byId("google-gis"), byId("microsoft-msal")];
  const logs = [];
  await runSelection({
    report,
    targets,
    cleanups: new Cleanups(report, () => {}),
    adapterFor: () => {
      throw new Error("must not be loaded");
    },
    setup: async () => ({ browser: undefined }),
    run: { runId: "r", env: {}, log: (line) => logs.push(line) },
  });
  const json = report.toJSON({ required: ["google-gis"] });
  for (const t of json.targets) {
    assert.ok(t.scenarios.length > 0);
    for (const s of t.scenarios) {
      assert.equal(s.status, UNTESTED);
      assert.match(
        s.reason,
        /missing RA_INTEROP_(GOOGLE_CLIENT_ID, RA_INTEROP_GOOGLE_EXPECTED_EMAIL|MSAL_CLIENT_ID, RA_INTEROP_MSAL_EXPECTED_UPN)/,
      );
    }
  }
  assert.equal(json.verdict.ok, false, "a required but untested target fails the verdict");
});

test("configured manual targets without --headed are UNTESTED, not run", async () => {
  const report = new Report({});
  await runSelection({
    report,
    targets: [byId("google-gis")],
    cleanups: new Cleanups(report, () => {}),
    adapterFor: () => {
      throw new Error("must not be loaded");
    },
    setup: async () => ({ browser: undefined }),
    run: { runId: "r", env: googleEnv, headed: false, log: () => {} },
  });
  for (const s of report.toJSON({}).targets[0].scenarios)
    assert.match(s.reason, /manual sign-in needs --headed/);
});

test("adapter scenario lists match the manifest spec", async () => {
  const env = {
    capabilities: { revocation: true, silentRenewal: true },
    context: async () => {
      throw new Error("no browser");
    },
  };
  for (const [id, module] of [
    ["google-gis", google],
    ["microsoft-msal", msal],
  ]) {
    const t = byId(id);
    const list = await module.scenarios(resolveTarget(t, { ...googleEnv, ...msalEnv }).config, env);
    assert.equal(selected(t, list).length, list.length);
    await module.close(list); // nothing was started
  }
  assert.equal(typeof adapterFor("google-gis").run, "function");
  assert.equal(typeof adapterFor("msal-browser").run, "function");
});

test("configuration validation", () => {
  const g = resolveTarget(byId("google-gis"), googleEnv).config;
  const problems = (module, base, change) => module.validate({ ...base, ...change }).join("\n");
  assert.match(
    problems(google, g, { clientId: "not-a-client" }),
    /clientId must be a Google OAuth client ID/,
  );
  assert.match(
    problems(google, g, { origin: "https://localhost:39440" }),
    /origin must be http on localhost/,
  );
  assert.match(
    problems(google, g, { origin: "http://example.com:39440" }),
    /origin must be http on localhost/,
  );
  assert.match(problems(google, g, { origin: "http://localhost" }), /explicit port/);
  assert.match(problems(google, g, { origin: "http://localhost:39440/app" }), /bare origin/);
  assert.match(
    problems(google, g, {
      api: { url: "http://www.googleapis.com/oauth2/v3/userinfo", identity: { field: "email" } },
    }),
    /api.url must be https/,
  );
  assert.match(
    problems(google, g, { api: { url: "https://www.googleapis.com/oauth2/v3/userinfo" } }),
    /identity.field is required/,
  );
  assert.match(problems(google, g, { scopes: [] }), /scopes must be a non-empty list/);
  assert.match(problems(google, g, { prompt: "login" }), /prompt must be one of/);
  assert.match(
    problems(google, g, { login: { recipe: "css-password" } }),
    /login.recipe must be manual/,
  );
  assert.deepEqual(
    google.validate({ ...g, login: { recipe: "session" } }),
    [],
    "the runner's session mode is accepted",
  );
  assert.match(
    problems(google, g, { api: { ...g.api, identity: { field: "email" } } }),
    /identity.expected .* is required unless api.identity.exploratory/,
  );
  assert.deepEqual(
    google.validate({ ...g, api: { ...g.api, identity: { field: "email", exploratory: true } } }),
    [],
    "explicit exploratory mode",
  );

  const m = resolveTarget(byId("microsoft-msal"), msalEnv).config;
  assert.match(problems(msal, m, { clientId: "my-app" }), /GUID/);
  assert.match(
    problems(msal, m, { authority: "http://login.microsoftonline.com/common" }),
    /authority must be an https URL/,
  );
  assert.match(problems(msal, m, { authority: undefined }), /authority is required/);
  assert.match(problems(msal, m, { origin: "http://127.0.0.1:39441?x" }), /bare origin/);
  assert.match(
    problems(msal, m, {
      api: { ...m.api, identity: { field: "userPrincipalName", expected: "" } },
    }),
    /identity.expected .* is required/,
  );
});

test("page origins must be bare loopback http origins with a port", () => {
  assert.equal(pageOriginProblem("http://localhost:39440"), undefined);
  assert.equal(pageOriginProblem("http://127.0.0.1:39440/"), undefined);
  assert.equal(pageOriginProblem("http://[::1]:39440"), undefined);
  assert.match(pageOriginProblem("http://user@localhost:39440"), /bare origin/);
  assert.match(pageOriginProblem("http://localhost:39440#x"), /bare origin/);
  assert.match(pageOriginProblem("nonsense"), /not a URL/);
});

test("the page server serves only its pages and bundles, no-store and without COOP", async () => {
  const server = await startPageServer("http://127.0.0.1:0");
  try {
    for (const path of [
      "/google.html",
      "/msal.html",
      "/redirect.html",
      "/.bundle/google.js",
      "/.bundle/msal.js",
      "/.bundle/redirect.js",
    ]) {
      const response = await fetch(`${server.origin}${path}`);
      await response.body?.cancel();
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
      assert.equal(response.headers.has("cross-origin-opener-policy"), false, path);
    }
    for (const path of ["/server.js", "/../package.json", "/.bundle/", "/google-entry.js"]) {
      const response = await fetch(`${server.origin}${path}`);
      await response.body?.cancel();
      assert.equal(response.status, 404, path);
    }
  } finally {
    await server.close();
  }
});

test("the decoy lets browsers send credentials and records any attempt, including preflights", async () => {
  const decoy = await corsDecoy();
  try {
    const plain = await fetch(`${decoy.url}/steal`, {
      headers: { origin: "http://localhost:39440" },
    });
    assert.equal(plain.status, 401);
    assert.equal(plain.headers.get("access-control-allow-origin"), "http://localhost:39440");
    assert.match(plain.headers.get("access-control-expose-headers"), /www-authenticate/);
    const preflight = await fetch(`${decoy.url}/steal`, {
      method: "OPTIONS",
      headers: {
        "access-control-request-headers": "Authorization",
        "access-control-request-method": "GET",
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
    await fetch(`${decoy.url}/steal`, { headers: { authorization: "Bearer x" } });
    assert.deepEqual(
      decoy.seen.map((s) => s.credentials),
      [false, true, true],
    );
  } finally {
    await decoy.close();
  }
});

test("session mode: Google revocation is not exercised unattended (it would withdraw the dedicated consent)", async () => {
  const t = byId("google-gis");
  const config = { ...resolveTarget(t, googleEnv).config, login: { recipe: "session" } };
  const list = await google.scenarios(config, {
    capabilities: { revocation: true },
    loginMode: "session",
    context: async () => {
      throw new Error("no browser");
    },
  });
  assert.match(
    list.find((s) => s.id === "gis.forget").untested(config),
    /session mode: revocation would withdraw/,
  );
  const manual = await google.scenarios(resolveTarget(t, googleEnv).config, {
    capabilities: { revocation: true },
    loginMode: "manual",
    context: async () => {
      throw new Error("no browser");
    },
  });
  assert.equal(manual.find((s) => s.id === "gis.forget").untested(config), undefined);
});

// Plausible-looking provider values: registered-code-shaped strings that carry an account and a credential.
const hostile = [
  { name: "InteractionRequiredAuthError", errorCode: "login_hint_interop_victim_example_com" },
  { name: "Interopvictimexamplecom", code: "access_token_ya29_a0ARrdaM_secret_value" },
  { name: "BrowserAuthError", error: "user_interop.victim@example.com" },
  { name: "eyJhbGciOiJSUzI1NiJ9", errorCode: "eyJhbGciOiJSUzI1NiJ9" },
];
const hostileStrings = hostile
  .flatMap((e) => Object.values(e))
  .filter((v) => !["InteractionRequiredAuthError", "BrowserAuthError"].includes(v));

test("error facts keep only allowlisted class names and codes", () => {
  assert.deepEqual(errorFacts({ name: "BrowserAuthError", errorCode: "user_cancelled" }), {
    name: "BrowserAuthError",
    code: "user_cancelled",
  });
  assert.deepEqual(errorFacts({ name: "AuthorizationFailedError", code: "popup_closed" }), {
    name: "AuthorizationFailedError",
    code: "popup_closed",
  });
  assert.deepEqual(
    errorFacts({ name: "InteractionRequiredAuthError", errorCode: "login_required" }),
    { name: "InteractionRequiredAuthError", code: "login_required" },
  );
  assert.deepEqual(errorFacts(hostile[0]), { name: "InteractionRequiredAuthError" });
  assert.deepEqual(errorFacts(hostile[1]), { name: "Error" });
  assert.deepEqual(errorFacts(hostile[2]), { name: "BrowserAuthError" });
  assert.deepEqual(errorFacts(hostile[3]), { name: "Error" });
  assert.deepEqual(errorFacts(undefined), { name: "Error" });
});

test("arbitrary provider error names/codes never reach a report, CheckError or the log", async () => {
  for (const live of [true, false]) {
    const report = new Report({});
    const target = {
      id: "t",
      name: "t",
      category: live ? "live" : "local",
      adapter: "x",
      software: { name: "x", source: "open" },
    };
    report.target(target);
    const logs = [];
    const scenarios = hostile.flatMap((e, i) => [
      // As the page reports it (errorFacts in the page) ...
      {
        id: `page-${i}`,
        run: async () => {
          throw pageFailure("authorization failed", { error: errorFacts(e), status: 400 });
        },
      },
      // ... and if raw SDK values ever reached the runner, pageFailure filters them again.
      {
        id: `raw-${i}`,
        run: async () => {
          throw pageFailure("authorization failed", { error: e, status: `HTTP 400 ${e.name}` });
        },
      },
    ]);
    await runScenarios(report, target, scenarios, {}, { live, log: (line) => logs.push(line) });
    const output = JSON.stringify(report.toJSON({})) + logs.join("\n");
    for (const value of hostileStrings)
      assert.ok(!output.includes(value), `leaked ${value} (live=${live})`);
    assert.match(output, /authorization failed: InteractionRequiredAuthError \(HTTP 400\)/);
    assert.match(output, /authorization failed: Error/);
  }
});

/** A loopback page with a harness whose `pending()` opens a popup and schedules late side effects. */
