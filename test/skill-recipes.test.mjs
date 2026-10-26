// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Execute the documented examples so API and credential-boundary regressions fail the gate.
import * as nodeCrypto from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as guardedFetch from "../packages/guarded-fetch/src/index.ts";

// Reuse existing package dependencies; the workspace root needs no new dependency.
const packageRequire = createRequire(
  new URL("../packages/solid-auth-core/package.json", import.meta.url),
);
const oauth = await import(packageRequire.resolve("oauth4webapi"));
const { Parser, Store } = packageRequire("n3");
const fixtureRequire = createRequire(
  new URL("../packages/solid-dpop/package.json", import.meta.url),
);
const jose = await import(fixtureRequire.resolve("jose"));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function blocks(skill, language, section = "", file = "SKILL.md") {
  const directory = skill === "fetch-rdf" ? "packages/fetch-rdf" : `skills/${skill}`;
  const markdown = readFileSync(new URL(`../${directory}/${file}`, import.meta.url), "utf8");
  const start = section ? markdown.indexOf(section) : 0;
  if (start < 0) throw new Error(`Missing section: ${section}`);
  return [
    ...markdown
      .slice(start)
      .matchAll(new RegExp(`\x60\x60\x60${language}\\n([\\s\\S]*?)\x60\x60\x60`, "g")),
  ].map((match) => match[1]);
}

async function execute(code, bindings, modules = {}, result = "undefined") {
  const { outputText } = ts.transpileModule(`${code}\nreturn ${result};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const requireModule = (name) => {
    if (!(name in modules)) throw new Error(`Unexpected recipe import: ${name}`);
    return modules[name];
  };
  return new AsyncFunction("require", "exports", ...Object.keys(bindings), outputText)(
    requireModule,
    {},
    ...Object.values(bindings),
  );
}

describe("Solid skill recipes", () => {
  it("configures static client identity with only the intended pod resource origin", async () => {
    const code = blocks("solid-client-id", "ts", "## Wiring into the shared auth core")[0];
    const login = vi.fn();
    const authenticatedFetch = vi.fn();
    const createSolidAuth = vi.fn(() => ({ login, authenticatedFetch }));
    const ui = {};
    await execute(
      code,
      {
        location: { href: "https://app.example/" },
        podRoot: "https://storage.example/alice/",
        webId: "https://identity.example/card#me",
        resourceUrl: "https://storage.example/alice/notes.ttl",
        ui,
      },
      { "@jeswr/solid-auth-core": { createSolidAuth } },
    );
    const [config] = createSolidAuth.mock.calls[0];
    expect(config.clientId).toBe("https://app.example/clientid.jsonld");
    expect(config.callbackUri).toBe("https://app.example/callback.html");
    expect(config.allowedOrigins).toEqual(["https://storage.example"]);
    expect(config.includeWebIdOrigin).toBe(false);
    expect(config.includeIssuerOrigin).toBe(false);
    expect(config.allowInsecureLoopback).not.toBe(true);
    // The UI element may be upgraded after construction; resolve getCode at call time.
    ui.getCode = vi.fn(async () => "https://app.example/callback.html?code=example");
    await config.authFlow.getCode("https://issuer.example/authorize");
    expect(ui.getCode).toHaveBeenCalledWith("https://issuer.example/authorize");
    expect(login).toHaveBeenCalledWith("https://identity.example/card#me");
    expect(authenticatedFetch).toHaveBeenCalledWith("https://storage.example/alice/notes.ttl");
  });

  it("returns verified claims and applies the symbol-keyed clock tolerance", async () => {
    const code = blocks("solid-auth", "ts")[0];
    const issuer = "https://issuer.example/";
    const audience = "https://resource.example/";
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
      kid: "recipe-key",
      alg: "ES256",
      use: "sig",
    };
    const jwksFetch = vi.fn(async () => Response.json({ keys: [jwk] }));
    const bindings = {
      trustedIssuers: new Set([issuer]),
      unverifiedIss: issuer,
      challenge: (_error, message) => new Error(message),
      as: { issuer, jwks_uri: `${issuer}jwks` },
      audience,
      dpop: false,
      SIGNING_ALGS: ["ES256"],
      oauth: {
        ...oauth,
        validateJwtAccessToken: (as, request, expectedAudience, options) =>
          oauth.validateJwtAccessToken(as, request, expectedAudience, {
            ...options,
            [oauth.customFetch]: jwksFetch,
          }),
      },
    };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: "alice",
      aud: audience,
      client_id: "app",
      jti: "recipe-token",
      iat: now - 60,
      exp: now - 3,
    };
    async function requestFor(payload) {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const input = `${encode({ alg: "ES256", typ: "at+jwt", kid: jwk.kid })}.${encode(payload)}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        new TextEncoder().encode(input),
      );
      return new Request(audience, {
        headers: {
          authorization: `Bearer ${input}.${Buffer.from(signature).toString("base64url")}`,
        },
      });
    }
    expect(
      await execute(code, { ...bindings, request: await requestFor(claims) }, {}, "claims"),
    ).toEqual(claims);
    await expect(
      execute(
        code,
        { ...bindings, request: await requestFor({ ...claims, exp: now - 30 }) },
        {},
        "claims",
      ),
    ).rejects.toThrow();
    expect(jwksFetch).toHaveBeenCalled();
    jwksFetch.mockClear();
    await expect(
      execute(code, {
        ...bindings,
        unverifiedIss: "https://untrusted.example/",
        request: await requestFor(claims),
      }),
    ).rejects.toThrow("Untrusted issuer.");
    expect(jwksFetch).not.toHaveBeenCalled();
  });

  it("discovers the private index through the profile's preferences link", () => {
    const examples = blocks("solid-type-index", "turtle", "## Create-and-link recipe");
    const webId = "https://pod.example/profile/card#me";
    const solid = "http://www.w3.org/ns/solid/terms#";
    const profile = new Store(
      new Parser({ baseIRI: "https://pod.example/profile/card" }).parse(examples[0]),
    );
    const preferencesUrl = profile.getObjects(
      webId,
      "http://www.w3.org/ns/pim/space#preferencesFile",
      null,
    )[0].value;
    expect(preferencesUrl).toBe("https://pod.example/settings/prefs.ttl");
    expect(profile.getObjects(webId, `${solid}publicTypeIndex`, null)[0].value).toBe(
      "https://pod.example/settings/publicTypeIndex.ttl",
    );
    expect(profile.getObjects(webId, `${solid}privateTypeIndex`, null)).toHaveLength(0);
    const preferences = new Store(new Parser({ baseIRI: preferencesUrl }).parse(examples[1]));
    expect(preferences.getObjects(webId, `${solid}privateTypeIndex`, null)[0].value).toBe(
      "https://pod.example/settings/privateTypeIndex.ttl",
    );
  });

  it("uses the exported pod-scope APIs and refuses escaping write targets before fetch", async () => {
    const code = blocks("fetch-rdf", "ts", "### Writing to a pod location safely")[0];
    const authenticatedFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const bindings = {
      podBase: "https://pod.example/alice/",
      authenticatedFetch,
      etag: '"v1"',
      turtle: "",
    };
    await execute(
      code,
      { ...bindings, resourceUrl: "notes.ttl" },
      { "@jeswr/guarded-fetch": guardedFetch },
    );
    expect(authenticatedFetch).toHaveBeenCalledOnce();
    const [input, init] = authenticatedFetch.mock.calls[0];
    const request = new Request(input, init);
    expect(request.url).toBe("https://pod.example/alice/notes.ttl");
    expect(request.method).toBe("PUT");
    expect(request.headers.get("if-match")).toBe('"v1"');
    for (const resourceUrl of [
      "https://foreign.example/steal",
      "../bob/notes.ttl",
      "https://pod.example/alice-evil/notes.ttl",
      "//foreign.example/steal",
    ]) {
      authenticatedFetch.mockClear();
      await expect(
        execute(code, { ...bindings, resourceUrl }, { "@jeswr/guarded-fetch": guardedFetch }),
      ).rejects.toThrow(guardedFetch.PodScopeError);
      expect(authenticatedFetch).not.toHaveBeenCalled();
    }
  });
});

// AUTHORED-BY Codex GPT-6
// Regressions from the second review: execute the recipes with adversarial ordering and failures.
describe("reviewed recipe failure boundaries", () => {
  it("requires a matching access-token hash on protected-resource DPoP proofs", async () => {
    const code = blocks("solid-auth", "ts")[0];
    const issuer = "https://issuer.example/";
    const audience = "https://resource.example/";
    const issuerKeys = await jose.generateKeyPair("ES256");
    const issuerJwk = {
      ...(await jose.exportJWK(issuerKeys.publicKey)),
      kid: "issuer",
      alg: "ES256",
    };
    const proofKeys = await jose.generateKeyPair("ES256");
    const proofJwk = await jose.exportJWK(proofKeys.publicKey);
    const claims = {
      iss: issuer,
      aud: audience,
      sub: "alice",
      client_id: "app",
      cnf: { jkt: await jose.calculateJwkThumbprint(proofJwk) },
    };
    const accessToken = await new jose.SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: issuerJwk.kid })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setJti(nodeCrypto.randomUUID())
      .sign(issuerKeys.privateKey);
    const ath = nodeCrypto.createHash("sha256").update(accessToken).digest("base64url");
    const bindings = {
      trustedIssuers: new Set([issuer]),
      unverifiedIss: issuer,
      audience,
      as: { issuer, jwks_uri: `${issuer}jwks` },
      dpop: true,
      SIGNING_ALGS: ["ES256"],
      challenge: (_error, message) => new Error(message),
      oauth: {
        ...oauth,
        validateJwtAccessToken: (as, request, expectedAudience, options) =>
          oauth.validateJwtAccessToken(as, request, expectedAudience, {
            ...options,
            [oauth.customFetch]: async () => Response.json({ keys: [issuerJwk] }),
          }),
      },
    };
    async function verify(hash) {
      const proof = await new jose.SignJWT({
        htu: audience,
        htm: "GET",
        ...(hash === undefined ? {} : { ath: hash }),
      })
        .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: proofJwk })
        .setIssuedAt()
        .setJti(nodeCrypto.randomUUID())
        .sign(proofKeys.privateKey);
      const request = new Request(audience, {
        headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
      });
      return execute(code, { ...bindings, request }, {}, "claims");
    }
    expect(await verify(ath)).toMatchObject(claims);
    await expect(verify(undefined)).rejects.toThrow();
    await expect(
      verify(nodeCrypto.createHash("sha256").update("another-token").digest("base64url")),
    ).rejects.toThrow();
  });

  it("retains DPoP replay entries through the proof's entire acceptance window", async () => {
    const code = blocks("solid-auth", "ts", "## 🔒 DPoP `jti` replay cache")[0];
    let now = 1000;
    const entries = new Map();
    const mark = vi.fn(async (jti, ttl) => {
      if ((entries.get(jti) ?? 0) > now) return "replay";
      entries.set(jti, now + ttl);
      return "ok";
    });
    const verify = (jti, iat) =>
      execute(code, {
        jti,
        iat,
        Date: { now: () => now * 1000 },
        replay: { mark },
        challenge: (_error, message) => new Error(message),
      });
    await verify("future-within-tolerance", 1005);
    expect(entries.get("future-within-tolerance")).toBe(1311);
    await expect(verify("too-far-in-future", 1005.01)).rejects.toThrow("acceptance window");
    expect(entries.has("too-far-in-future")).toBe(false);
    now = 1306; // beyond a fixed 305-second TTL, but this proof is still acceptable
    await expect(verify("future-within-tolerance", 1005)).rejects.toThrow("replayed");
    now = 1309.9;
    await expect(verify("future-within-tolerance", 1005)).rejects.toThrow("replayed");
    await verify("fractional-ttl", 1005);
    expect(entries.get("fractional-ttl")).toBe(1310.9); // round remaining EX seconds up
    now = 1310;
    await expect(verify("future-within-tolerance", 1005)).rejects.toThrow("replayed");
    await verify("inclusive-boundary", 1005);
    expect(entries.get("inclusive-boundary")).toBe(1311);
    now = 1310.01;
    mark.mockClear();
    await expect(verify("expired", 1005)).rejects.toThrow("acceptance window");
    expect(mark).not.toHaveBeenCalled();
  });

  it("posts the exact discovered notification channel type to its service", async () => {
    const code = blocks("solid-notifications", "ts", "### 2. Subscribe")[0];
    for (const channelTypeIri of [
      "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
      "https://server.example/channels#WebSocketChannel2023",
    ]) {
      const fetch = vi.fn(async () =>
        Response.json({ receiveFrom: "wss://server.example/receive" }),
      );
      const subscriptionServiceUrl = "https://server.example/subscriptions";
      const resourceUrl = "https://pod.example/notes.ttl";
      expect(
        await execute(
          code,
          { fetch, subscriptionServiceUrl, channelTypeIri, resourceUrl },
          {},
          "wsUrl",
        ),
      ).toBe("wss://server.example/receive");
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(subscriptionServiceUrl);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toMatchObject({ type: channelTypeIri, topic: resourceUrl });
    }
  });

  it.each([
    [1, 2],
    [2, 1],
  ])("restores the confirmed baseline when edits fail in order %s, %s", async (first, second) => {
    const code = blocks("solid-app-shell", "ts", "### Trap 2")[0];
    const { enqueueMutation, settleMutation, visibleValue } = await execute(
      code,
      {},
      {},
      "({ enqueueMutation, settleMutation, visibleValue })",
    );
    const baseline = { id: "one", priority: 0, status: "todo", state: "open", title: "Original" };
    let state = { baseline, pending: [] };
    state = enqueueMutation(state, 1, { priority: 1 });
    state = enqueueMutation(state, 2, { priority: 2 });
    state = enqueueMutation(state, 3, { title: "Newer title" });
    const beforeFailure = structuredClone(state);
    const afterFirst = settleMutation(state, first, false);
    expect(state).toEqual(beforeFailure); // React may replay the updater
    expect(settleMutation(state, first, false)).toEqual(afterFirst);
    expect(visibleValue(afterFirst).priority).toBe(first === 1 ? 2 : 1);
    state = settleMutation(afterFirst, second, false);
    expect(visibleValue(state)).toEqual({ ...baseline, title: "Newer title" });
    state = settleMutation(state, 3, true);
    expect(state).toEqual({ baseline: { ...baseline, title: "Newer title" }, pending: [] });
    const replacement = { baseline, pending: [] };
    expect(settleMutation(replacement, first, false)).toBe(replacement);
  });

  it.each([
    [1, 2, 3],
    [3, 2, 1],
    [2, 1, 3],
    [2, 3, 1],
    [1, 3, 2],
    [3, 1, 2],
  ])("keeps newer successful edits when outcomes arrive %s, %s, %s", async (...order) => {
    const code = blocks("solid-app-shell", "ts", "### Trap 2")[0];
    const { enqueueMutation, settleMutation, visibleValue } = await execute(
      code,
      {},
      {},
      "({ enqueueMutation, settleMutation, visibleValue })",
    );
    const baseline = { id: "one", priority: 0, status: "todo", state: "open", title: "Original" };
    let state = { baseline, pending: [] };
    for (const [generation, priority] of [
      [1, 1],
      [2, 2],
      [3, 1],
    ]) {
      state = enqueueMutation(state, generation, { priority });
    }
    for (const generation of order) {
      state = settleMutation(state, generation, generation !== 1);
      expect(visibleValue(state).priority).toBe(1);
    }
    expect(state).toEqual({ baseline: { ...baseline, priority: 1 }, pending: [] });
    state = enqueueMutation(state, 4, { status: "done", state: "closed" });
    state = enqueueMutation(state, 5, { priority: 3 });
    state = settleMutation(state, 5, true);
    state = settleMutation(state, 4, false);
    expect(visibleValue(state)).toEqual({ ...baseline, priority: 3 });
  });

  it("treats storage acquisition and read errors as misses without weakening identity checks", async () => {
    const code = blocks("solid-offline-patterns", "ts").find((block) =>
      block.includes("function read("),
    );
    const webId = "https://pod.example/alice/card#me";
    const resource = "https://pod.example/alice/items";
    const keyFor = (identity, url) => `${identity}\u0000${url}`;
    const envelope = { v: 2, at: 100, webId, resource, data: [{ title: "Cached" }] };
    async function readWith(storageGlobal) {
      return execute(
        code,
        { globalThis: storageGlobal, keyFor, VERSION: 2, MAX_AGE_MS: 1000 },
        {},
        "read",
      );
    }
    for (const storageGlobal of [
      {},
      {
        get localStorage() {
          throw new DOMException("Denied", "SecurityError");
        },
      },
      {
        localStorage: {
          getItem() {
            throw new DOMException("Denied", "SecurityError");
          },
        },
      },
    ]) {
      const read = await readWith(storageGlobal);
      expect(read(webId, resource, 100)).toBeNull();
    }
    const getItem = vi.fn(() => JSON.stringify(envelope));
    const read = await readWith({ localStorage: { getItem } });
    expect(read(webId, resource, 100)).toEqual(envelope.data);
    expect(getItem).toHaveBeenCalledWith(keyFor(webId, resource));
    expect(read(null, resource, 100)).toBeNull();
    expect(read("https://pod.example/bob/card#me", resource, 100)).toBeNull();
    expect(read(webId, `${resource}/other`, 100)).toBeNull();
    expect(read(webId, resource, 2000)).toBeNull();
    getItem.mockReturnValue(JSON.stringify({ ...envelope, v: 1 }));
    expect(read(webId, resource, 100)).toBeNull();
    getItem.mockReturnValue("broken JSON");
    expect(read(webId, resource, 100)).toBeNull();
  });

  it("seeds distinct accounts on successive setups against the same reused CSS", async () => {
    const code = blocks("solid-test-infrastructure", "ts", "", "references/global-setup.ts.md")[0];
    const base = "http://localhost:3000";
    const emails = new Set(["alice@example.com"]);
    const pods = new Set(["alice"]);
    const profiles = new Map();
    const env = {};
    const fetch = vi.fn(async (url, init = {}) => {
      const json = init.body?.startsWith("{") ? JSON.parse(init.body) : {};
      if (url === `${base}/.account/`) {
        return Response.json({
          controls: {
            password: { create: `${base}/password` },
            account: { pod: `${base}/pod`, clientCredentials: `${base}/credentials` },
          },
        });
      }
      if (url === `${base}/.account/account/`) {
        return Response.json({}, { headers: { "set-cookie": "session=test; Path=/" } });
      }
      if (url === `${base}/password`) {
        if (emails.has(json.email)) return Response.json({}, { status: 409 });
        emails.add(json.email);
        return Response.json({});
      }
      if (url === `${base}/pod`) {
        if (pods.has(json.name)) return Response.json({}, { status: 409 });
        pods.add(json.name);
        return Response.json({});
      }
      if (url === `${base}/credentials`)
        return Response.json({ id: "fixture", secret: "test-only" });
      if (url === `${base}/.oidc/token`) {
        expect(jose.decodeJwt(init.headers.dpop).ath).toBeUndefined();
        return Response.json({ access_token: "fixture-access-token" });
      }
      if (init.method === "PUT") {
        const proof = init.headers.dpop;
        const { jwk } = jose.decodeProtectedHeader(proof);
        const { payload } = await jose.jwtVerify(proof, await jose.importJWK(jwk));
        expect(payload.ath).toBe(
          nodeCrypto.createHash("sha256").update("fixture-access-token").digest("base64url"),
        );
        expect(payload.htu).toBe(url);
        profiles.set(url, new Store(new Parser({ baseIRI: url }).parse(init.body)));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    const setup = await execute(
      code,
      { fetch, process: { env }, console: { log: vi.fn() } },
      { jose, "node:crypto": nodeCrypto },
      "globalSetup",
    );
    await setup();
    const first = JSON.parse(env.SOLID_E2E_ACCOUNT);
    await setup();
    const second = JSON.parse(env.SOLID_E2E_ACCOUNT);
    expect(first.webId).not.toBe(second.webId);
    expect(first.email).not.toBe(second.email);
    for (const account of [first, second]) {
      expect(emails.has(account.email)).toBe(true);
      expect(account.password).toBeTruthy();
      const profileUrl = account.webId.split("#")[0];
      expect(
        profiles
          .get(profileUrl)
          .getObjects(account.webId, "http://www.w3.org/ns/pim/space#storage", null)[0].value,
      ).toBe(account.podRoot);
    }
  });

  it.each([
    "fresh",
    "consent-only",
    "incomplete",
  ])("completes popup login from feature beforeEach (%s)", async (flow) => {
    const code = blocks(
      "solid-test-infrastructure",
      "ts",
      "",
      "references/feature.spec.example.ts.md",
    )[0];
    const context = new EventEmitter();
    let phase = flow === "consent-only" ? "consent" : "email";
    const account = {
      webId: "http://localhost:3000/e2e-test/profile/card#me",
      email: "fixture@example.com",
      password: "test-only",
    };
    const fills = new Map();
    const popup = {
      isClosed: () => phase === "done",
      locator: (selector) => ({
        isVisible: async () => phase === "email" && selector === "#email",
        fill: async (value) => {
          fills.set(selector, value);
        },
      }),
      getByRole: (_role, { name }) => ({
        isVisible: async () => phase === "consent" && name.test("Authorize"),
        click: async () => {
          if (name.test("Log in")) {
            expect(fills.get("#email")).toBe(account.email);
            expect(fills.get("#password")).toBe(account.password);
            phase = "consent";
          } else if (name.test("Authorize") && phase === "consent") {
            if (flow !== "incomplete") phase = "done";
          } else throw new Error("Unexpected popup action");
        },
      }),
    };
    const page = {
      goto: vi.fn(),
      context: () => context,
      fill: vi.fn(async (_selector, value) => {
        expect(value).toBe(account.webId);
      }),
      click: async () => {
        expect(context.listenerCount("page")).toBe(1);
        context.emit("page", { isClosed: () => true }); // transient prompt=none
        context.emit("page", popup);
      },
      getByRole: () => ({ isVisible: async () => phase === "done" }),
    };
    const beforeEach = [];
    const test = Object.assign(() => {}, {
      describe: (_name, body) => body(),
      beforeEach: (callback) => beforeEach.push(callback),
    });
    // Drive Playwright's polling contract deterministically over popup state transitions.
    const playwrightExpect = {
      poll: (callback) => ({
        toBe: async (expected) => {
          for (let attempt = 0; attempt < 4; attempt++) {
            if ((await callback()) === expected) return;
          }
          throw new Error("Login did not complete");
        },
      }),
    };
    await execute(
      code,
      { process: { env: { SOLID_E2E_ACCOUNT: JSON.stringify(account) } } },
      { "@playwright/test": { test, expect: playwrightExpect } },
    );
    expect(beforeEach).toHaveLength(1);
    if (flow === "incomplete") {
      await expect(beforeEach[0]({ page })).rejects.toThrow("Login did not complete");
    } else {
      await beforeEach[0]({ page });
      expect(phase).toBe("done");
    }
    expect(context.listenerCount("page")).toBe(0);
  });
});
