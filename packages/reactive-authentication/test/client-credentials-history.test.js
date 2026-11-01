// AUTHORED-BY Claude Opus 5.5
import assert from "node:assert/strict";
import { test } from "vitest";
import { challengeContext } from "../src/challenge.js";
import { ClientCredentialsTokenProvider, XASProvider } from "../src/mod.js";

const issuer = "https://as.example/";

function provider() {
  let grants = 0;
  const http = {
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          token_endpoint: `${issuer}token`,
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
      grants++;
      return Response.json({ access_token: `at-${grants}`, token_type: "DPoP", expires_in: 300 });
    },
  };
  const instance = new ClientCredentialsTokenProvider(
    new XASProvider({ getIssuer: async () => new URL(issuer) }, http),
    "bot",
    "s3cret",
    { http },
  );
  return { instance, grants: () => grants };
}

const challenge = () =>
  challengeContext(
    new Response(null, { status: 401, headers: { "www-authenticate": 'DPoP algs="ES256"' } }),
  );
const token = (request) => request.headers.get("authorization");

test("client credentials keep a bounded token history and exact contexts for outstanding requests", async () => {
  const { instance, grants } = provider();
  const upgrade = async () =>
    await instance.upgrade(new Request("https://rs.example/data"), challenge());
  try {
    const first = await upgrade();
    assert.equal(token(first), "DPoP at-1");

    // Renew well past the history bound through request copies, which use the token history.
    let current = first;
    for (let i = 0; i < 120; i++) {
      await instance.invalidate(current.clone());
      current = await upgrade();
    }
    assert.equal(grants(), 121);
    assert.equal(token(current), "DPoP at-121");

    // A copy of an evicted, superseded token never removes the current one.
    await instance.invalidate(first.clone());
    assert.equal(token(await upgrade()), "DPoP at-121");
    assert.equal(grants(), 121);

    // The outstanding original keeps its exact context; its stale token still cannot remove the current one.
    await instance.invalidate(first);
    assert.equal(token(await upgrade()), "DPoP at-121");

    // The current token is renewed when its outstanding original is rejected.
    await instance.invalidate(current);
    assert.equal(token(await upgrade()), "DPoP at-122");

    // Requests without credentials are ignored.
    await instance.invalidate(new Request("https://rs.example/data"));
    assert.equal(grants(), 122);
  } finally {
    await instance.forget();
  }
});
