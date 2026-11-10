// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import route from "../api/index.js";

afterEach(() => vi.unstubAllEnvs());
it("exports a Vercel fetch Web handler and fails closed without configuration", async () => {
  vi.stubEnv("MCP_PUBLIC_ORIGIN", "");
  const response = await route.fetch(new Request("https://mcp.example/healthz"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "service_unavailable" });
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
});
it("retries configuration after failure and serves a native Web request", async () => {
  vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://mcp.example");
  vi.stubEnv("MCP_MODE", "oauth");
  vi.stubEnv("MCP_VAULT_STORE", "memory");
  vi.stubEnv("MCP_VAULT_KEY", Buffer.alloc(32, 4).toString("base64"));
  vi.stubEnv("VERCEL", "");
  const response = await route.fetch(new Request("https://mcp.example/healthz"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
