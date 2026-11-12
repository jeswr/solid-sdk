// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { buildClientId, trustedClientOrigin } from "../src/shell/lib/client-id";

describe("client identifier document", () => {
  it("uses the exact request origin and path without query or fragment", () => {
    expect(
      buildClientId("http://127.0.0.1:3311/.well-known/solid-client-id.jsonld?query=1#ignored"),
    ).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: "http://127.0.0.1:3311/.well-known/solid-client-id.jsonld",
      client_name: "Solid Suite",
      logo_uri: "http://127.0.0.1:3311/icon.svg",
      redirect_uris: [
        "http://127.0.0.1:3311/auth/callback.html",
        "http://127.0.0.1:3311/settings/move-pod/callback/target",
      ],
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
    expect(document.redirect_uris).toEqual([
      "https://suite.example.org/auth/callback.html",
      "https://suite.example.org/settings/move-pod/callback/target",
    ]);
    expect(document.logo_uri).toBe("https://suite.example.org/icon.svg");
  });
  it("takes the origin from configuration, never from the request host", () => {
    const req = "https://attacker.example/.well-known/solid-client-id.jsonld";
    expect(trustedClientOrigin({ NEXT_PUBLIC_SUITE_ORIGIN: "https://suite.example" }, req)).toEqual(
      {
        origin: "https://suite.example",
        cacheable: true,
      },
    );
    expect(
      trustedClientOrigin(
        { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "suite.example.org" },
        req,
      ).origin,
    ).toBe("https://suite.example.org");
    expect(
      trustedClientOrigin({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app" }, req).origin,
    ).toBe("https://b.vercel.app");
    expect(trustedClientOrigin({ VERCEL_URL: "d.vercel.app" }, req).origin).toBe(
      "https://d.vercel.app",
    );
    expect(trustedClientOrigin({}, req)).toEqual({ cacheable: false });
    expect(trustedClientOrigin({ NEXT_PUBLIC_SUITE_ORIGIN: "http://suite.example" }, req)).toEqual({
      cacheable: false,
    });
    expect(trustedClientOrigin({ NEXT_PUBLIC_SUITE_ORIGIN: "::bad::" }, req)).toEqual({
      cacheable: false,
    });
  });
  it("answers loopback development requests without caching", () => {
    expect(
      trustedClientOrigin({}, "http://127.0.0.1:3210/.well-known/solid-client-id.jsonld"),
    ).toEqual({ origin: "http://127.0.0.1:3210", cacheable: false });
    expect(
      trustedClientOrigin({ NEXT_PUBLIC_SUITE_ORIGIN: "http://localhost:3000" }, "x:"),
    ).toEqual({ origin: "http://localhost:3000", cacheable: true });
  });
});
