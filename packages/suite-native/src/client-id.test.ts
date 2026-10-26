// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "vitest";
import { MOBILE_CLIENT_ID_PATH, MOBILE_REDIRECT_URI, mobileClientIdDocument } from "./client-id.js";

test("builds a native Client Identifier Document whose client_id is its own URL", () => {
  const document = mobileClientIdDocument({
    origin: "https://suite.example",
    logoPath: "/logo.png",
  });
  expect(document).toEqual({
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: `https://suite.example${MOBILE_CLIENT_ID_PATH}`,
    client_name: "Solid Suite",
    client_uri: "https://suite.example/",
    logo_uri: "https://suite.example/logo.png",
    application_type: "native",
    redirect_uris: [MOBILE_REDIRECT_URI],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

test("accepts a custom name and redirect, and a loopback origin for local development", () => {
  const document = mobileClientIdDocument({
    origin: "http://localhost:3210",
    clientName: "Suite (dev)",
    redirectUri: "org.jeswr.suite.dev:/oauth/callback",
  });
  expect(document.client_id).toBe(`http://localhost:3210${MOBILE_CLIENT_ID_PATH}`);
  expect(document.client_name).toBe("Suite (dev)");
  expect(document.redirect_uris).toEqual(["org.jeswr.suite.dev:/oauth/callback"]);
  expect(document).not.toHaveProperty("logo_uri");
});

test.each([
  ["http origin", { origin: "http://suite.example" }],
  ["origin with a path", { origin: "https://suite.example/app" }],
  ["origin with a query", { origin: "https://suite.example/?x" }],
  ["relative logo", { origin: "https://suite.example", logoPath: "logo.png" }],
])("rejects %s", (_, options) => {
  expect(() => mobileClientIdDocument(options)).toThrow(TypeError);
});
