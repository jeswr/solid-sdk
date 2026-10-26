// AUTHORED-BY Codex GPT-6.1-Sol
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertEndpointTransport, assertIssuerTransport } from "@jeswr/solid-dpop";
import { normalizePodRoot } from "./auth.js";

/** Local stdio configuration. Environment values override the private JSON file. */
export interface CliConfig {
  podRoot: string;
  webId?: string;
  readOnly: boolean;
  clientId?: string;
  clientSecret?: string;
  oidcIssuer?: string;
  tokenUrl?: string;
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    // Inspect the opened inode to avoid a check/read race; refuse symlinks/FIFOs.
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Cannot open ~/.config/solid-mcp/config.json (must be a regular 0600 file).");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600) {
      throw new Error("~/.config/solid-mcp/config.json must be a regular file with mode 0600.");
    }
    let value: unknown;
    try {
      value = JSON.parse(await file.readFile("utf8"));
    } catch {
      throw new Error("~/.config/solid-mcp/config.json must contain valid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("~/.config/solid-mcp/config.json must contain a JSON object.");
    }
    return value as Record<string, unknown>;
  } finally {
    await file.close();
  }
}

function stringValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string.`);
  return value;
}

/** Read configuration without exposing values in diagnostics. */
export async function loadCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<CliConfig> {
  const file = await readConfig(join(home, ".config", "solid-mcp", "config.json"));
  const podRoot = stringValue(env.SOLID_MCP_POD_ROOT ?? file.podRoot, "SOLID_MCP_POD_ROOT");
  if (!podRoot) throw new Error("SOLID_MCP_POD_ROOT (or config podRoot) is required.");
  const webId = stringValue(env.SOLID_MCP_WEBID ?? file.webId, "SOLID_MCP_WEBID");
  const clientId = stringValue(env.SOLID_MCP_CLIENT_ID ?? file.clientId, "SOLID_MCP_CLIENT_ID");
  const clientSecret = stringValue(
    env.SOLID_MCP_CLIENT_SECRET ?? file.clientSecret,
    "SOLID_MCP_CLIENT_SECRET",
  );
  const oidcIssuer = stringValue(
    env.SOLID_MCP_OIDC_ISSUER ?? file.oidcIssuer,
    "SOLID_MCP_OIDC_ISSUER",
  );
  const tokenUrl = stringValue(env.SOLID_MCP_TOKEN_URL ?? file.tokenUrl, "SOLID_MCP_TOKEN_URL");
  let readOnly = file.readOnly === undefined ? true : file.readOnly;
  if (env.SOLID_MCP_READONLY !== undefined) {
    const value = env.SOLID_MCP_READONLY.toLowerCase();
    if (value !== "true" && value !== "false")
      throw new Error("SOLID_MCP_READONLY must be true or false.");
    readOnly = value === "true";
  }
  if (typeof readOnly !== "boolean") throw new Error("config readOnly must be a boolean.");
  if (
    (clientId || clientSecret || oidcIssuer || tokenUrl) &&
    !(clientId && clientSecret && (oidcIssuer || tokenUrl))
  ) {
    throw new Error(
      "Client credentials require CLIENT_ID, CLIENT_SECRET and OIDC_ISSUER or TOKEN_URL.",
    );
  }
  try {
    normalizePodRoot(podRoot);
    const root = new URL(podRoot);
    if (root.username || root.password || root.search || root.hash) throw new Error();
    if (clientId) assertEndpointTransport(podRoot, "podRoot");
    for (const value of [oidcIssuer, tokenUrl]) {
      if (!value) continue;
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash) throw new Error();
      assertIssuerTransport(value);
    }
  } catch {
    throw new Error("Invalid pod/auth URL; authenticated URLs require HTTPS or HTTP loopback.");
  }
  return { podRoot, webId, readOnly, clientId, clientSecret, oidcIssuer, tokenUrl };
}
