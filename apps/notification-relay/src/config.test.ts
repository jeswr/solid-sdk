// AUTHORED-BY Codex GPT-6.1-Sol

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { afterEach, expect, test, vi } from "vitest";
import { configuredRelay } from "./config.js";

vi.mock("@jeswr/guarded-fetch/node", () => ({ createNodeGuardedFetch: vi.fn(() => vi.fn()) }));
afterEach(() => vi.unstubAllEnvs());
const env = {
  RELAY_PUBLIC_URL: "https://relay.example",
  RELAY_ID_TOKEN_AUDIENCE: "https://app.example/clientid",
  RELAY_TRUSTED_ISSUERS: JSON.stringify([
    { issuer: "https://issuer.example", jwksUri: "https://issuer.example/jwks" },
  ]),
};
test("requires deployment trust configuration", () => {
  for (const name of Object.keys(env))
    expect(() => configuredRelay({ ...env, [name]: "" })).toThrow("Configure");
  expect(() => configuredRelay({ ...env, RELAY_TRUSTED_ISSUERS: "invalid" })).toThrow();
});
test("uses DNS-pinned bounded fetch with no redirects and explicit browser origins", async () => {
  const relay = configuredRelay({
    ...env,
    RELAY_ALLOWED_ORIGINS: "https://app.example,https://other.example",
  });
  try {
    expect(createNodeGuardedFetch).toHaveBeenCalledWith({
      maxBytes: 262_144,
      timeoutMs: 8_000,
      maxRedirects: 0,
    });
    expect(
      (
        await relay.handle(
          new Request("https://relay.example/register", {
            method: "OPTIONS",
            headers: { origin: "https://app.example" },
          }),
        )
      ).status,
    ).toBe(204);
  } finally {
    relay.close();
  }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fromEnvironment = configuredRelay();
  fromEnvironment.close();
});
