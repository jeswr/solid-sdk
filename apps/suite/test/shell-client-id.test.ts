// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { buildClientId } from "../src/shell/lib/client-id";

describe("client identifier document", () => {
  it("uses the exact request origin and path without query or fragment", () => {
    expect(
      buildClientId("http://127.0.0.1:3311/.well-known/solid-client-id.jsonld?query=1#ignored"),
    ).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: "http://127.0.0.1:3311/.well-known/solid-client-id.jsonld",
      client_name: "Solid Suite",
      logo_uri: "http://127.0.0.1:3311/icon.svg",
      redirect_uris: ["http://127.0.0.1:3311/auth/callback.html"],
      post_logout_redirect_uris: ["http://127.0.0.1:3311/welcome"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid profile offline_access webid",
      token_endpoint_auth_method: "none",
      application_type: "web",
      dpop_bound_access_tokens: true,
    });
  });
  it("uses a trusted configured origin consistently", () => {
    const document = buildClientId(
      "http://internal:3000/.well-known/solid-client-id.jsonld",
      "https://suite.example.org/",
    );
    expect(document.client_id).toBe("https://suite.example.org/.well-known/solid-client-id.jsonld");
    expect(document.redirect_uris).toEqual(["https://suite.example.org/auth/callback.html"]);
    expect(document.logo_uri).toBe("https://suite.example.org/icon.svg");
  });
});
