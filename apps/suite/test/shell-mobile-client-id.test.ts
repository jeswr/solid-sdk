// AUTHORED-BY Codex GPT-6
import { MOBILE_REDIRECT_URI } from "@jeswr/suite-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as webGET } from "../src/app/.well-known/solid-client-id.jsonld/route";
import { GET } from "../src/app/.well-known/solid-client-id-mobile.jsonld/route";
import { buildClientId } from "../src/shell/lib/client-id";

const path = "/.well-known/solid-client-id-mobile.jsonld";
const deploymentKeys = [
  "NEXT_PUBLIC_SUITE_ORIGIN",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
] as const;

beforeEach(() => {
  for (const key of deploymentKeys) vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mobile Client Identifier Document route", () => {
  it("serves native metadata with the web document's name and logo and public CORS", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_ORIGIN", "https://suite.example/");
    const response = GET(
      new Request(`https://attacker.example${path}?ignored=1#ignored`, {
        headers: {
          host: "poison.example",
          "x-forwarded-host": "poison.example",
          "x-forwarded-proto": "http",
          origin: "capacitor://localhost",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/ld+json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const document = await response.json();
    expect(document).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: `https://suite.example${path}`,
      client_name: "Solid Suite",
      client_uri: "https://suite.example/",
      logo_uri: "https://suite.example/icon.svg",
      application_type: "native",
      redirect_uris: [MOBILE_REDIRECT_URI],
      scope: "openid webid offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    });
    const web = buildClientId("https://suite.example/.well-known/solid-client-id.jsonld");
    expect(document.client_name).toBe(web.client_name);
    expect(document.logo_uri).toBe(web.logo_uri);
  });

  it.each([
    {
      env: {
        NEXT_PUBLIC_SUITE_ORIGIN: "https://configured.example/",
        VERCEL_URL: "ignored.vercel.app",
      },
      origin: "https://configured.example",
    },
    {
      env: {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "production.example",
        VERCEL_BRANCH_URL: "ignored.vercel.app",
      },
      origin: "https://production.example",
    },
    {
      env: {
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "ignored.example",
        VERCEL_BRANCH_URL: "branch.vercel.app",
        VERCEL_URL: "ignored.vercel.app",
      },
      origin: "https://branch.vercel.app",
    },
    { env: { VERCEL_URL: "deployment.vercel.app" }, origin: "https://deployment.vercel.app" },
    {
      env: {
        NEXT_PUBLIC_SUITE_ORIGIN: "http://insecure.example",
        VERCEL_URL: "fallback.vercel.app",
      },
      origin: "https://fallback.vercel.app",
    },
  ])("matches the web route's configured trust rules for $origin", async ({ env, origin }) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const request = new Request(`http://internal:3000${path}`);
    const response = GET(request);
    const webResponse = webGET(request);
    expect(response.status).toBe(webResponse.status);
    expect(response.headers.get("cache-control")).toBe(webResponse.headers.get("cache-control"));
    expect((await response.json()).client_id).toBe(`${origin}${path}`);
  });

  it.each([
    undefined,
    "http://insecure.example",
    "::bad::",
  ])("returns 404 without trusted configuration (%s), ignoring proxy headers", (configured) => {
    vi.stubEnv("NEXT_PUBLIC_SUITE_ORIGIN", configured);
    const request = new Request(`https://attacker.example${path}`, {
      headers: {
        host: "localhost",
        "x-forwarded-host": "localhost",
        forwarded: "host=localhost;proto=http",
      },
    });
    const response = GET(request);
    expect(response.status).toBe(404);
    expect(response.status).toBe(webGET(request).status);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it.each([
    "http://localhost:3210",
    "http://127.0.0.1:3210",
    "http://[::1]:3210",
  ])("answers unconfigured loopback at %s without caching", async (origin) => {
    const request = new Request(`${origin}${path}`, { headers: { host: "attacker.example" } });
    const response = GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cache-control")).toBe(
      webGET(request).headers.get("cache-control"),
    );
    expect((await response.json()).client_id).toBe(`${origin}${path}`);
  });
});
