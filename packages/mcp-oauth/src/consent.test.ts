// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { type ConsentContext, consentDisplay } from "./index.js";

function context(): ConsentContext {
  return {
    request: new Request("https://mcp.example/authorize"),
    client: {
      client_id: "opaque",
      client_id_issued_at: 100,
      redirect_uris: [],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    authorization: {
      clientId: "opaque",
      redirectUri: "https://éxample.example/cb?x=<img>&q=\"'",
      resource: "https://mcp.example/mcp",
      state: "state",
      scope: "mcp<",
      challenge: "pkce",
    },
    session: { id: "session", webId: "https://pod.example/#me" },
  };
}

it("renders escaped and bidi-isolated consent with unverified DCR names and exact redirects", () => {
  const value = context();
  value.client.client_name = "Trusted\u202E app\n<script>";
  const html = consentDisplay(value);
  expect(html).toContain("<bdi>Trusted app&lt;script&gt;</bdi> (unverified (self-declared))");
  expect(html).toContain("<strong><bdi>xn--xample-9ua.example</bdi></strong>");
  expect(html).toContain("<bdi>https://éxample.example/cb?x=&lt;img&gt;&amp;q=&quot;&#39;</bdi>");
  expect(html).toContain("<bdi>mcp&lt;</bdi>");
  expect(html).not.toContain("\u202E");
  expect(
    consentDisplay({ ...value, client: { ...value.client, client_name: undefined } }),
  ).toContain("<bdi>opaque</bdi> (unverified");
});

it("identifies metadata-document clients by URL host, including punycode, with optional names", () => {
  const value = context();
  value.client.client_id = "https://bücher.example:8443/client.json";
  value.client.client_name = "<a>";
  expect(consentDisplay(value)).toContain(
    "Client: <strong><bdi>xn--bcher-kva.example:8443</bdi></strong>",
  );
  expect(consentDisplay(value)).toContain("Client name (self-declared): <bdi>&lt;a&gt;</bdi>");
  delete value.client.client_name;
  expect(consentDisplay(value)).toContain("Client name (self-declared): <bdi></bdi>");
});

it("keeps the exact redirect spelling inside bidi isolation, including format characters", () => {
  const value = context();
  value.authorization.redirectUri = "https://client.example/cb?value=a\u202Eb";
  expect(consentDisplay(value)).toContain(`<bdi>${value.authorization.redirectUri}</bdi>`);
});
