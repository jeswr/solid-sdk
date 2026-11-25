// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test } from "vitest";
import { desktopClientIdDocument } from "./client-id.js";
import * as api from "./index.js";

const base = {
  clientId: "https://jeswr.github.io/artcraft/solid-client-id.jsonld",
  clientName: "ArtCraft",
  clientUri: "https://github.com/jeswr/artcraft",
  redirectUri: "ai.artcraft.app:/oauth/callback",
};

describe("desktopClientIdDocument", () => {
  test("builds a native document whose client_id is the served URL", () => {
    expect(desktopClientIdDocument(base)).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: base.clientId,
      client_name: "ArtCraft",
      client_uri: "https://github.com/jeswr/artcraft",
      application_type: "native",
      redirect_uris: [base.redirectUri],
      scope: "openid webid offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    });
  });

  test("adds a logo on the clientId origin", () => {
    const logo = "https://jeswr.github.io/artcraft/logo.png";
    expect(desktopClientIdDocument({ ...base, logoUri: logo }).logo_uri).toBe(logo);
  });

  test("trims the name", () => {
    expect(desktopClientIdDocument({ ...base, clientName: "  ArtCraft " }).client_name).toBe(
      "ArtCraft",
    );
  });

  test.each([
    ["clientId", "not a url"],
    ["clientId", "http://jeswr.github.io/artcraft/id.jsonld"],
    ["clientId", "http://localhost:3000/id.jsonld"],
    ["clientId", "https://user:pw@jeswr.github.io/id.jsonld"],
    ["clientId", "https://jeswr.github.io/id.jsonld#me"],
    ["clientId", "https://jeswr.github.io/id.jsonld?v=1"],
    ["clientId", "https://JESWR.github.io/id.jsonld"],
    ["clientId", "https://jeswr.github.io/a/../id.jsonld"],
    ["clientUri", "http://example.com/"],
    ["clientUri", "nope"],
    ["clientName", ""],
    ["clientName", "   "],
    ["clientName", "x".repeat(101)],
    ["clientName", 42],
    ["redirectUri", "https://artcraft.example/callback"],
    ["redirectUri", "artcraft:/callback"],
    ["redirectUri", "ai.artcraft.app://host/callback"],
    ["redirectUri", "ai.artcraft.app:/callback?x=1"],
    ["logoUri", "https://evil.example/logo.png"],
    ["logoUri", "http://jeswr.github.io/logo.png"],
  ])("rejects %s %s", (field, value) => {
    expect(() => desktopClientIdDocument({ ...base, [field]: value } as typeof base)).toThrow(
      TypeError,
    );
  });
});

test("the entry point exposes the runtime API", () => {
  expect(Object.keys(api).sort()).toEqual([
    "HOST_FAILED",
    "MAX_CALLBACK_LENGTH",
    "TIMED_OUT",
    "createDesktopAuthSession",
    "createDesktopCodeDriver",
    "desktopClientIdDocument",
  ]);
});
