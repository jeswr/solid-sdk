// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCodeForToken, generatePkcePair } from "../../core/oauth.js";
import { createGoogleOAuthConfig, GOOGLE_SCOPES, type GoogleProduct } from "./oauth.js";

const params = {
  code: "synthetic-code",
  verifier: "synthetic-verifier",
  redirectUri: "http://127.0.0.1:41387/callback",
};

describe("shared Google OAuth configuration", () => {
  it.each(
    Object.keys(GOOGLE_SCOPES) as GoogleProduct[],
  )("requests only %s's read scope with PKCE", async (product) => {
    const config = createGoogleOAuthConfig(product, {
      clientType: "desktop",
      clientId: "synthetic-client",
    });
    const pair = await generatePkcePair();
    const url = new URL(
      buildAuthorizationUrl(config, {
        state: "synthetic-state",
        challenge: pair.challenge,
        redirectUri: params.redirectUri,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES[product].join(" "));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pair.challenge);
    expect(url.searchParams.get("state")).toBe("synthetic-state");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("exchanges an injected Desktop client configuration on the source transport only", async () => {
    const config = createGoogleOAuthConfig("calendar", {
      clientType: "desktop",
      clientId: "synthetic-client",
      clientSecret: "synthetic-installed-app-value",
    });
    const fetch = vi.fn(async () =>
      Response.json({ access_token: "synthetic-token", refresh_token: "synthetic-refresh" }),
    );
    const token = await exchangeCodeForToken("google-calendar", config, params, fetch);
    expect(fetch.mock.calls).toHaveLength(1);
    const [endpoint, init] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(endpoint).toBe("https://oauth2.googleapis.com/token");
    expect(init.redirect).toBe("error");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("client_secret")).toBe(config.clientSecret);
    expect(form.get("code_verifier")).toBe(params.verifier);
    expect(form.get("redirect_uri")).toBe(params.redirectUri);
    expect(token.refreshToken).toBe("synthetic-refresh");
    const url = buildAuthorizationUrl(config, {
      state: "synthetic-state",
      challenge: "synthetic-challenge",
      redirectUri: params.redirectUri,
    });
    expect(url).not.toContain(config.clientSecret);
  });

  it("defaults to an unconfigured browser proxy and never sends a local secret to that proxy", async () => {
    expect(createGoogleOAuthConfig("calendar").tokenExchange).toBe("proxy");
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ access_token: "synthetic-token" }),
    );
    await expect(
      exchangeCodeForToken("google-calendar", createGoogleOAuthConfig("calendar"), params, fetch),
    ).rejects.toMatchObject({ reason: "not-configured" });
    expect(fetch).not.toHaveBeenCalled();
    const config = createGoogleOAuthConfig("calendar", {
      clientId: "synthetic-web-client",
      tokenProxyUrl: "https://proxy.test/google",
    });
    await exchangeCodeForToken(
      "google-calendar",
      { ...config, clientSecret: "synthetic-unused-value" },
      params,
      fetch,
    );
    expect(fetch.mock.calls[0][0]).toBe("https://proxy.test/google");
    expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).has("client_secret")).toBe(
      false,
    );
  });

  it.each([
    400, 401, 500,
  ])("does not expose token endpoint responses on failure (%s)", async (status) => {
    const config = createGoogleOAuthConfig("calendar", {
      clientType: "desktop",
      clientId: "synthetic-client",
    });
    await expect(
      exchangeCodeForToken(
        "google-calendar",
        config,
        params,
        async () => new Response("synthetic-private-response", { status }),
      ),
    ).rejects.toMatchObject({
      reason: "exchange-failed",
      message: `Token exchange failed (${status}).`,
    });
  });
});
