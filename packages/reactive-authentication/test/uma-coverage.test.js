// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { afterAll, beforeAll, test } from "vitest";
import { challengeContext } from "../src/challenge.js";
import {
  DynamicRegistrationClientProvider,
  ID_TOKEN_CLAIM_FORMAT,
  SolidUmaTokenProvider,
  XASProvider,
} from "../src/mod.js";
import { insecure, transport } from "./helpers/http.js";
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js";
import { callback } from "./helpers/solid.js";
import { startUma } from "./helpers/uma.js";

let op, uma;
beforeAll(async () => {
  op = await startOpenIdProvider({ webId: "https://alice.example/#me" });
  uma = await startUma(op);
});
afterAll(async () => {
  await uma.close();
  await op.close();
});
function provider(fetch, options = {}) {
  return new SolidUmaTokenProvider(
    callback,
    automaticCodeProvider(),
    new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
    new DynamicRegistrationClientProvider(insecure),
    { http: { ...insecure, fetch }, ...options },
  );
}

test("UMA discovery rejects HTTP errors, issuer mismatches and unsupported profiles or grants", async () => {
  const base = {
    issuer: uma.url,
    token_endpoint: `${uma.url}/token`,
    uma_profiles_supported: [ID_TOKEN_CLAIM_FORMAT],
  };
  for (const [body, status, error] of [
    [{}, 503, /discovery failed/],
    [{ ...base, issuer: undefined }, 200, /does not match/],
    [{ ...base, issuer: "https://foreign.example/" }, 200, /does not match/],
    [{ ...base, token_endpoint: undefined }, 200, /token_endpoint/],
    [{ ...base, uma_profiles_supported: "invalid" }, 200, /ID token profile/],
    [{ ...base, uma_profiles_supported: [] }, 200, /ID token profile/],
    [{ ...base, grant_types_supported: ["unsupported"] }, 200, /uma-ticket grant/],
  ]) {
    const p = provider(async (url, init) =>
      String(url).endsWith("uma2-configuration")
        ? Response.json(body, { status })
        : transport(url, init),
    );
    const request = new Request(`${uma.url}/uma/private`);
    const challenge = challengeContext(await transport(request));
    await assert.rejects(p.upgrade(request, challenge), error);
    await p.forget();
  }
});

test("UMA accepts Bearer RPTs without an expiry and surfaces unrecognised exchange failures", async () => {
  let mode = "bearer";
  const p = provider(async (url, init) => {
    const response = await transport(url, init);
    if (String(url).endsWith("uma2-configuration")) {
      const body = await response.json();
      delete body.grant_types_supported;
      return Response.json(body);
    }
    if (String(url) === `${uma.url}/token`) {
      if (mode === "error") return Response.json({ error: "server_error" }, { status: 400 });
      const body = await response.json();
      body.token_type = "Bearer";
      delete body.expires_in;
      return Response.json(body);
    }
    return response;
  });
  const request = new Request(`${uma.url}/uma/private`);
  const upgraded = await p.upgrade(request, challengeContext(await transport(request)));
  assert.match(upgraded.headers.get("authorization"), /^Bearer /);
  assert.equal(upgraded.headers.has("dpop"), false);
  await p.invalidate(upgraded);
  mode = "error";
  await assert.rejects(
    p.upgrade(request, challengeContext(await transport(request))),
    (error) => error.error === "server_error",
  );
  await p.forget();
});

for (const tokenType of ["DPoP", "Bearer"]) {
  test(`UMA invalidation retains each request's context when an RPT is reused (${tokenType})`, async () => {
    let context = "first";
    let sharedToken;
    let exchanges = 0;
    const p = provider(
      async (url, init) => {
        const response = await transport(url, init);
        if (String(url) !== `${uma.url}/token`) return response;
        const body = await response.json();
        body.token_type = tokenType;
        if (++exchanges === 1) sharedToken = body.access_token;
        if (exchanges === 2) body.access_token = sharedToken;
        return Response.json(body);
      },
      { context: () => context },
    );
    const request = new Request(`${uma.url}/uma/changing-context`);
    const upgrade = async () =>
      await p.upgrade(request, challengeContext(await transport(request)));
    try {
      const first = await upgrade();
      context = "second";
      const second = await upgrade();
      assert.equal(first.headers.get("authorization"), second.headers.get("authorization"));
      await p.invalidate(first);
      context = "first";
      const renewed = await upgrade();
      assert.notEqual(renewed.headers.get("authorization"), first.headers.get("authorization"));
      assert.equal(exchanges, 3);
      await p.invalidate(first);
      assert.equal(
        (await upgrade()).headers.get("authorization"),
        renewed.headers.get("authorization"),
      );
      context = "second";
      assert.equal(
        (await upgrade()).headers.get("authorization"),
        second.headers.get("authorization"),
      );
      assert.equal(exchanges, 3, "the other context and the replacement remain cached");
      await p.invalidate(second.clone());
      assert.notEqual(
        (await upgrade()).headers.get("authorization"),
        second.headers.get("authorization"),
      );
      assert.equal(exchanges, 4, "copies use the verified resource context");
      await p.invalidate(request);
      await p.invalidate(new Request(`${uma.url}/uma/unknown`));
      assert.equal(exchanges, 4);
    } finally {
      await p.forget();
    }
  });
}

for (const tokenType of ["DPoP", "Bearer"]) {
  test(`UMA nonce retries require a DPoP RPT and a complete nonce challenge (${tokenType})`, async () => {
    const p = provider(async (url, init) => {
      const response = await transport(url, init);
      if (String(url) === `${uma.url}/token`) {
        const body = await response.json();
        body.token_type = tokenType;
        delete body.expires_in;
        return Response.json(body);
      }
      return response;
    });
    const request = new Request(`${uma.url}/uma/nonce-without-expiry`);
    try {
      const original = await p.upgrade(request, challengeContext(await transport(request)));
      for (const headers of [
        { "www-authenticate": 'DPoP error="use_dpop_nonce"' },
        { "dpop-nonce": "nonce" },
        { "www-authenticate": 'DPoP error="invalid_token"', "dpop-nonce": "nonce" },
      ]) {
        await assert.rejects(
          p.upgrade(request, challengeContext(new Response(null, { status: 401, headers }))),
          /UMA challenge/,
        );
      }
      const nonce = challengeContext(
        new Response(null, {
          status: 401,
          headers: { "www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "nonce" },
        }),
      );
      if (tokenType === "Bearer") await assert.rejects(p.upgrade(request, nonce), /RPT context/);
      else {
        const retried = await p.upgrade(request, nonce);
        assert.equal(retried.headers.get("authorization"), original.headers.get("authorization"));
        assert.notEqual(retried.headers.get("dpop"), original.headers.get("dpop"));
      }
    } finally {
      await p.forget();
    }
  });
}

test("UMA need_info error fields keep strings and discard malformed redirect hints", async () => {
  const p = provider(async (url, init) =>
    String(url) === `${uma.url}/token`
      ? Response.json({ error: "need_info", ticket: 42, redirect_user: false }, { status: 403 })
      : transport(url, init),
  );
  const request = new Request(`${uma.url}/uma/private`);
  await assert.rejects(
    p.upgrade(request, challengeContext(await transport(request))),
    (error) =>
      error.name === "UmaAuthorizationError" &&
      error.ticket === undefined &&
      error.redirectUser === undefined,
  );
  await p.forget();
});

test("UMA rejects an exchange when caller configuration did not request an ID token", async () => {
  const p = provider(transport, { scopes: ["webid"] });
  const request = new Request(`${uma.url}/uma/private`);
  await assert.rejects(
    p.upgrade(request, challengeContext(await transport(request))),
    (error) => error.name === "UmaAuthorizationError" && error.error === "invalid_grant",
  );
  await p.forget();
});
