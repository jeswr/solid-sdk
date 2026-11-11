// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { afterEach, expect, test, vi } from "vitest";
import { configuredRelay, productionRelay } from "./config.js";
import { createRelayOutboundFetch } from "./outbound.js";
import { InMemoryRelayStore } from "./store.js";

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
test("uses DNS-pinned bounded fetch with three redirects and explicit browser origins", async () => {
  const relay = configuredRelay({
    ...env,
    RELAY_ALLOWED_ORIGINS: "https://app.example,https://other.example",
  });
  try {
    expect(createNodeGuardedFetch).toHaveBeenCalledWith({
      maxBytes: 262_144,
      timeoutMs: 5_000,
      maxRedirects: 3,
      allowLoopback: false,
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

test("composition accepts shared storage and an explicitly test-only loopback transport", () => {
  const outboundFetch = createRelayOutboundFetch({ allowLoopbackForTests: true });
  const relay = configuredRelay(
    {
      ...env,
      RELAY_PUBLIC_URL: "http://127.0.0.1:3000",
      RELAY_MOBILE_CLIENT_ID: "https://mobile.example/clientid.jsonld",
    },
    { outboundFetch, store: new InMemoryRelayStore() },
  );
  relay.close();
  expect(createNodeGuardedFetch).toHaveBeenCalledWith(
    expect.objectContaining({ allowLoopback: true }),
  );
});

test("production refuses non-production environments and every injected transport", () => {
  for (const NodeEnv of [undefined, "test", "development"])
    expect(() => productionRelay({ ...env, NODE_ENV: NodeEnv })).toThrow("Production relay");
  const production = { ...env, NODE_ENV: "production", RELAY_ALLOW_LOOPBACK_FOR_TESTS: "true" };
  for (const outboundFetch of [createRelayOutboundFetch({ allowLoopbackForTests: true }), vi.fn()])
    expect(() => productionRelay(production, { outboundFetch })).toThrow("own outbound transport");
  const relay = productionRelay(production);
  relay.close();
  expect(createNodeGuardedFetch).toHaveBeenLastCalledWith({
    maxBytes: 262_144,
    timeoutMs: 5_000,
    maxRedirects: 3,
    allowLoopback: false,
  });
  for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
  const fromEnvironment = productionRelay();
  fromEnvironment.close();
});

test("the executable entry refuses startup outside production before opening a listener", async () => {
  vi.stubEnv("NODE_ENV", "test");
  await expect(import("./server.js")).rejects.toThrow("Production relay");
});
