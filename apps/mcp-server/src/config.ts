// AUTHORED-BY Codex GPT-6.1-Sol

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { createSessionVault, FileVaultStore, MemoryVaultStore } from "@jeswr/mcp-oauth";
import { createApp } from "./handler.js";
import { createSingleUserApp } from "./single-user.js";

export async function appFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const upstreamFetch = createNodeGuardedFetch({
    allowLoopback: env.MCP_ALLOW_LOOPBACK === "true",
    maxBytes: 1024 * 1024,
    timeoutMs: 8_000,
    maxRedirects: 0,
  });
  const options = {
    publicOrigin: required("MCP_PUBLIC_ORIGIN"),
    readOnly: env.MCP_READ_ONLY !== "false",
    allowedOrigins: env.MCP_ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [],
    upstreamFetch,
  };
  if (env.MCP_MODE === "single-user")
    return createSingleUserApp({
      ...options,
      allowInsecureLoopback: env.MCP_ALLOW_LOOPBACK === "true",
      accessToken: required("MCP_ACCESS_TOKEN"),
      podRoot: required("SOLID_MCP_POD_ROOT"),
      webId: required("SOLID_MCP_WEBID"),
      credentials: {
        issuer: required("SOLID_MCP_ISSUER"),
        id: required("SOLID_MCP_CLIENT_ID"),
        secret: required("SOLID_MCP_CLIENT_SECRET"),
      },
    });
  if (env.MCP_MODE && env.MCP_MODE !== "oauth") throw new Error("Invalid MCP_MODE");
  const store = env.MCP_VAULT_STORE ?? "kv";
  if (!["kv", "file", "memory"].includes(store)) throw new Error("Invalid MCP_VAULT_STORE");
  if (env.VERCEL && store !== "kv") throw new Error("Vercel requires shared KV persistence");
  const vault = createSessionVault({
    key: required("MCP_VAULT_KEY"),
    ...(store === "file" ? { store: new FileVaultStore(required("MCP_VAULT_DIRECTORY")) } : {}),
    ...(store === "memory" ? { store: new MemoryVaultStore() } : {}),
  });
  return createApp({ ...options, vault });
}
