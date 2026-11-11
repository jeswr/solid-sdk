// AUTHORED-BY Claude Opus 5.5
//
// Coverage guard for the live sign-in matrix: every Solid identity provider the suite advertises
// on a sign-in screen must have an entry in scripts/sign-in-live/providers.json, so the scheduled
// sign-in-live workflow tests it. Also unit-tests the dependency-free protocol checker.
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkJwks,
  checkProvider,
  classifyAuthorizeEnd,
  corsAllows,
  preflightAllowsHeaders,
  sameIssuer,
} from "../scripts/sign-in-live/check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const matrix = JSON.parse(read("scripts/sign-in-live/providers.json"));

/** Source files under `dir` (skipping dependencies, builds and tests). */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (
      ["node_modules", "dist", ".next", "test", "tests", "__tests__", "e2e", "e2e-live"].includes(
        name,
      )
    )
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Every issuer a sign-in screen offers, with where it came from. */
function advertisedIssuers() {
  const found = [];
  // 1. The shared provider directory every migrated app renders.
  const directory = read("packages/pod-auth/src/directory.ts");
  const block = directory.slice(directory.indexOf("export const KNOWN_PROVIDERS"));
  const known = block.slice(0, block.indexOf("].map(")).matchAll(/issuer:\s*"([^"]+)"/g);
  for (const [, issuer] of known) found.push({ issuer, from: "pod-auth KNOWN_PROVIDERS" });
  // 2. The suite's default provider list.
  const env = read("apps/suite/src/shell/lib/env.ts");
  const suiteDefault = env.match(
    /NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS:[\s\S]*?\.default\("([^"]+)"\)/,
  )?.[1];
  for (const issuer of suiteDefault?.split(",") ?? [])
    found.push({ issuer, from: "suite default providers" });
  // 3. Home-provider defaults (`…HOME_IDP ?? "https://…"`, `homeIdp ?? "https://…"`) in app
  //    sign-in screens and in shared packages such as app-session's LoginScreen.
  for (const file of [...sources(join(root, "apps")), ...sources(join(root, "packages"))]) {
    for (const [, issuer] of read(relative(root, file)).matchAll(
      /(?:HOME_IDP|homeIdp)\s*\?\?\s*"(https:[^"]+)"/g,
    )) {
      found.push({ issuer, from: relative(root, file) });
    }
  }
  return found;
}

/** Advertised issuers with no live-test entry. */
function untested(advertised, providers) {
  return advertised.filter((a) => !providers.some((p) => sameIssuer(p.issuer, a.issuer)));
}

describe("sign-in provider matrix", () => {
  const advertised = advertisedIssuers();

  it("finds the advertised providers (the guard is not vacuous)", () => {
    const fromDirectory = advertised.filter((a) => a.from === "pod-auth KNOWN_PROVIDERS");
    expect(fromDirectory.length).toBeGreaterThanOrEqual(4);
    expect(advertised.some((a) => a.from === "suite default providers")).toBe(true);
    expect(advertised.some((a) => a.from.startsWith("apps/"))).toBe(true);
    expect(advertised.map((a) => a.from)).toContain("packages/app-session/src/LoginScreen.tsx");
  });

  it("has a live-test entry for every advertised provider", () => {
    expect(
      untested(advertised, matrix.providers),
      "add these providers to scripts/sign-in-live/providers.json",
    ).toEqual([]);
  });

  it("flags a changed shared home-provider default that has no entry", () => {
    const changed = advertised.map((a) =>
      a.from === "packages/app-session/src/LoginScreen.tsx"
        ? { ...a, issuer: "https://new-idp.example/" }
        : a,
    );
    expect(untested(changed, matrix.providers)).toEqual([
      { issuer: "https://new-idp.example/", from: "packages/app-session/src/LoginScreen.tsx" },
    ]);
  });

  it("has unique provider ids and https issuers, and complete app clients", () => {
    const ids = matrix.providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of matrix.providers) {
      expect(new URL(p.issuer).protocol).toBe("https:");
      // Positive evidence of each provider's login page, so an error page never passes.
      expect(typeof p.loginPage?.marker, `${p.id} loginPage.marker`).toBe("string");
      new RegExp(p.loginPage.marker);
      if (p.loginPage.at !== undefined) new RegExp(p.loginPage.at);
    }
    for (const app of matrix.apps) {
      for (const key of ["url", "clientId", "redirectUri"])
        expect(new URL(app[key]).protocol).toBe("https:");
    }
  });
});

describe("sign-in protocol checker", () => {
  it("compares issuers across the trailing-slash difference only", () => {
    expect(sameIssuer("https://idp.example", "https://idp.example/")).toBe(true);
    expect(sameIssuer("https://idp.example/a/", "https://idp.example/a")).toBe(true);
    expect(sameIssuer("https://idp.example", "https://idp.example.evil")).toBe(false);
    expect(sameIssuer("https://idp.example", "http://idp.example")).toBe(false);
    expect(sameIssuer("not a url", "https://idp.example")).toBe(false);
  });

  it("reads CORS headers", () => {
    const h = (o) => new Headers(o);
    expect(corsAllows(h({ "access-control-allow-origin": "*" }), "https://a.example")).toBe(true);
    expect(
      corsAllows(h({ "access-control-allow-origin": "https://a.example" }), "https://a.example"),
    ).toBe(true);
    expect(
      corsAllows(h({ "access-control-allow-origin": "https://b.example" }), "https://a.example"),
    ).toBe(false);
    expect(corsAllows(h({}), "https://a.example")).toBe(false);
    expect(
      preflightAllowsHeaders(h({ "access-control-allow-headers": "Content-Type, DPoP" }), [
        "content-type",
        "dpop",
      ]),
    ).toBe(true);
    expect(preflightAllowsHeaders(h({ "access-control-allow-headers": "*" }), ["dpop"])).toBe(true);
    expect(
      preflightAllowsHeaders(h({ "access-control-allow-headers": "content-type" }), [
        "content-type",
        "dpop",
      ]),
    ).toBe(false);
  });

  it("classifies where an authorization request ends", () => {
    const redirect = "https://app.example/callback.html";
    const loginPage = { at: "^idp\\.example/login$", marker: 'type="password"' };
    const base = {
      status: 200,
      location: null,
      contentType: "text/html",
      body: '<title>Sign in</title><form><input type="password"></form>',
      where: "idp.example/login",
    };
    expect(classifyAuthorizeEnd(base, redirect, loginPage)).toEqual({
      ok: true,
      detail: 'login page at idp.example/login ("Sign in")',
    });
    expect(
      classifyAuthorizeEnd({ ...base, body: "<p>invalid_client</p>" }, redirect, loginPage).ok,
    ).toBe(false);
    // A maintenance or holding page is not a login page, even with a 200.
    const maintenance = classifyAuthorizeEnd(
      { ...base, body: "<title>Service unavailable</title><p>Back soon</p>" },
      redirect,
      loginPage,
    );
    expect(maintenance.ok).toBe(false);
    expect(maintenance.detail).toContain("is not the login page");
    expect(
      classifyAuthorizeEnd({ ...base, where: "idp.example/maintenance" }, redirect, loginPage),
    ).toEqual({
      ok: false,
      detail:
        'ended at idp.example/maintenance ("Sign in"), not the login page (^idp\\.example/login$)',
    });
    expect(classifyAuthorizeEnd(base, redirect, undefined).ok).toBe(false);
    expect(
      classifyAuthorizeEnd({ ...base, status: 401, body: "Unauthorized" }, redirect, loginPage),
    ).toEqual({
      ok: false,
      detail: "401 at idp.example/login: Unauthorized",
    });
    expect(
      classifyAuthorizeEnd(
        {
          ...base,
          status: 400,
          contentType: "application/json",
          body: '{"error":"invalid_request"}',
        },
        redirect,
        loginPage,
      ).ok,
    ).toBe(false);
    const back = `${redirect}?error=invalid_client&error_description=unknown`;
    expect(
      classifyAuthorizeEnd({ ...base, status: 303, location: back }, redirect, loginPage),
    ).toEqual({
      ok: false,
      detail: "redirected back with error=invalid_client (unknown)",
    });
  });

  it("requires a JWKS with public signing keys", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pub = ec.publicKey.export({ format: "jwk" });
    expect(checkJwks(JSON.stringify({ keys: [{ ...pub, use: "sig" }] }))).toEqual({
      ok: true,
      detail: "1 signing key(s)",
    });
    expect(checkJwks("<html>oops</html>").ok).toBe(false);
    expect(checkJwks(JSON.stringify({ keys: [] }))).toEqual({ ok: false, detail: "no keys" });
    expect(checkJwks(JSON.stringify({ keys: [{ ...pub, use: "enc" }] })).detail).toBe(
      "no public signing keys",
    );
    expect(checkJwks(JSON.stringify({ keys: [ec.privateKey.export({ format: "jwk" })] })).ok).toBe(
      false,
    );
    expect(checkJwks(JSON.stringify({ keys: [{ kty: "oct", k: "c2VjcmV0" }] })).ok).toBe(false);
  });

  it("passes a healthy provider and fails one that rejects the app's client", async () => {
    const issuer = "https://idp.example/";
    const app = {
      id: "app",
      url: "https://app.example/",
      clientId: "https://app.example/id",
      redirectUri: "https://app.example/cb",
    };
    const cors = { "access-control-allow-origin": "https://app.example" };
    const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({
      format: "jwk",
    });
    const metadata = {
      issuer,
      authorization_endpoint: "https://idp.example/auth",
      token_endpoint: "https://idp.example/token",
      jwks_uri: "https://idp.example/jwks",
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "webid"],
      dpop_signing_alg_values_supported: ["ES256"],
    };
    const fake =
      (authorize) =>
      async (url, init = {}) => {
        const u = new URL(url);
        if (u.pathname === "/.well-known/openid-configuration")
          return Response.json(metadata, { headers: cors });
        if (u.pathname === "/jwks") return Response.json({ keys: [jwk] }, { headers: cors });
        if (u.pathname === "/token" && init.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: { ...cors, "access-control-allow-headers": "content-type,dpop" },
          });
        }
        if (u.pathname === "/auth") return authorize(u);
        if (u.pathname === "/login")
          return new Response('<form><input type="password"></form>', {
            headers: { "content-type": "text/html" },
          });
        return new Response("not found", { status: 404 });
      };
    const healthy = await checkProvider(
      { id: "p", issuer, loginPage: { at: "^idp\\.example/login$", marker: 'type="password"' } },
      [app],
      fake(() => new Response(null, { status: 303, headers: { location: "/login" } })),
    );
    expect(healthy.filter((r) => !r.ok)).toEqual([]);
    expect(healthy.map((r) => r.check)).toEqual([
      "discovery",
      "metadata",
      "jwks",
      "authorize",
      "token-cors",
    ]);

    const rejecting = await checkProvider(
      { id: "p", issuer, loginPage: { at: "^idp\\.example/login$", marker: 'type="password"' } },
      [app],
      fake(() => new Response("Unauthorized", { status: 401 })),
    );
    expect(rejecting.filter((r) => !r.ok).map((r) => [r.check, r.detail])).toEqual([
      ["authorize", "401 at idp.example/auth: Unauthorized"],
    ]);
  });

  it("reports an unreachable provider instead of throwing", async () => {
    const results = await checkProvider(
      { id: "down", issuer: "https://down.example" },
      [
        {
          id: "app",
          url: "https://app.example/",
          clientId: "x",
          redirectUri: "https://app.example/cb",
        },
      ],
      async () => {
        throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
      },
    );
    expect(results).toEqual([
      {
        provider: "down",
        check: "discovery",
        app: "app",
        ok: false,
        warn: false,
        detail: "fetch failed (ENOTFOUND)",
      },
    ]);
  });
});
