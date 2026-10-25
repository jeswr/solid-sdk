// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { test } from "vitest";
import { OAuthCodeSource } from "../src/mod.js";
import { insecure, transport } from "./helpers/http.js";
import { startOAuthProvider } from "./helpers/oauth.js";
import { automaticCodeProvider } from "./helpers/openid.js";

test("OAuth sources validate supplied stores, sort configuration keys and transmit audiences", async () => {
  const options = {
    issuer: "https://issuer.example/",
    clientId: "client",
    redirectUri: "https://app.example/cb",
    scopes: ["read"],
    codeProvider: {},
  };
  assert.throws(
    () => new OAuthCodeSource({ ...options, cache: createMemoryStore() }),
    /SessionFence/,
  );
  const provider = await startOAuthProvider();
  try {
    const code = automaticCodeProvider();
    const http = {
      ...insecure,
      fetch: async (url, init) => {
        const response = await transport(url, init);
        if (new URL(url).pathname !== "/token") return response;
        const body = await response.json();
        delete body.expires_in;
        return Response.json(body, { status: response.status });
      },
    };
    const source = new OAuthCodeSource({
      ...options,
      issuer: provider.issuer,
      codeProvider: code,
      audience: "https://api.example/",
      parameters: { z_custom: "z", a_custom: "a" },
      http,
    });
    const access = await source.authorize();
    assert.equal(typeof access.token, "string");
    assert.equal("expiresAt" in access, false);
    assert.equal(provider.stats.authorize.at(-1).audience, "https://api.example/");
    assert.equal(provider.stats.token.at(-1).audience, "https://api.example/");
    await source.forget();
    const failed = new OAuthCodeSource({
      ...options,
      issuer: `${provider.issuer}missing`,
      http: insecure,
    });
    await assert.rejects(failed.authorize());
    await assert.rejects(failed.authorize());
  } finally {
    await provider.close();
  }
});
