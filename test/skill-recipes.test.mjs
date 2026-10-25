// AUTHORED-BY Codex GPT-6
// Execute the documented examples so API and credential-boundary regressions fail the gate.
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
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function blocks(skill, language, section = "") {
  const markdown = readFileSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), "utf8");
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
    const code = blocks("solid-fetch-rdf", "ts", "### Writing to a pod location safely")[0];
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
