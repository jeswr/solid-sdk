import assert from "node:assert/strict";
import * as oauth from "oauth4webapi";
import { test } from "vitest";
import { clientAuthFor, expectedNonce } from "../src/serverQuirks.js";

async function basicHeader(auth) {
  const headers = new Headers();
  await auth({}, { client_id: "id with space" }, new URLSearchParams(), headers);
  return headers.get("authorization");
}

test("compatibility exceptions apply only to the exact listed issuer origins and can be disabled", async () => {
  const client = {
    client_id: "id with space",
    client_secret: "s/cret",
    token_endpoint_auth_method: "client_secret_basic",
  };
  const standard = await basicHeader(oauth.ClientSecretBasic("s/cret"));
  assert.notEqual(
    await basicHeader(clientAuthFor("https://login.inrupt.com", client)),
    standard,
    "ESS workaround",
  );
  for (const lookalike of [
    "https://login.inrupt.com.evil.example",
    "https://evil.example/login.inrupt.com",
    "https://xlogin.inrupt.com",
  ]) {
    assert.equal(await basicHeader(clientAuthFor(lookalike, client)), standard, lookalike);
  }
  assert.equal(
    await basicHeader(clientAuthFor("https://login.inrupt.com", client, false)),
    standard,
    "disabled",
  );

  assert.equal(expectedNonce("https://solidweb.org", "n"), oauth.expectNoNonce);
  assert.equal(expectedNonce("https://solidweb.org/", "n"), oauth.expectNoNonce);
  assert.equal(expectedNonce("https://solidweb.org.evil.example", "n"), "n");
  assert.equal(expectedNonce("https://solidweb.org", "n", false), "n");
  assert.equal(expectedNonce("https://op.example", "n"), "n");
});
