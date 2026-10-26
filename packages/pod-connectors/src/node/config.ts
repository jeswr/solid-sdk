// AUTHORED-BY Codex GPT-6.1-Sol
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getuid } from "node:process";
import { httpsUrl, NodeRuntimeError, object, textValue } from "./errors.js";

/** Node-only source settings; desktop client secrets remain in memory. */
export interface NodeConnectorConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenProxyUrl?: string;
}

/** Shared MCP client-credentials settings with a connector-specific OAuth section. */
export interface NodeConfig {
  readonly podRoot: string;
  readonly webId: string;
  readonly profileDocumentUrl: string;
  readonly oidcIssuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl?: string;
  readonly connectors: Readonly<Record<string, NodeConnectorConfig>>;
}

/** W9 MCP-12's conventional config location; no process environment is read. */
export function defaultConfigPath(): string {
  return join(homedir(), ".config", "solid-mcp", "config.json");
}

/** Open once, check the same descriptor, and refuse symlinks, non-files and non-0600 modes. */
export async function readNodeConfig(path = defaultConfigPath()): Promise<NodeConfig> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o7777) !== 0o600 ||
        stat.size > 1024 * 1024 ||
        (getuid && stat.uid !== getuid())
      )
        throw new Error("Unsafe configuration file");
      return parseNodeConfig(JSON.parse(await file.readFile("utf8")));
    } finally {
      await file.close();
    }
  } catch {
    throw new NodeRuntimeError(
      "config",
      "Cannot load config: use an owner-held regular file with mode 0600 and valid settings.",
    );
  }
}

function parseNodeConfig(value: unknown): NodeConfig {
  const cfg = object(value);
  if (cfg.readOnly !== undefined && cfg.readOnly !== false) throw new Error("Writes disabled");
  const podRoot = httpsUrl(cfg.podRoot);
  if (!podRoot.endsWith("/") || new URL(podRoot).search) throw new Error("Invalid Pod root");
  const webId = httpsUrl(cfg.webId, true);
  const profile = new URL(webId);
  profile.hash = "";
  const connectors: Record<string, NodeConnectorConfig> = {};
  for (const [id, value] of Object.entries(
    cfg.connectors === undefined ? {} : object(cfg.connectors),
  )) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid connector id");
    const source = object(value);
    connectors[id] = {
      clientId: textValue(source.clientId),
      ...(source.clientSecret === undefined
        ? {}
        : { clientSecret: textValue(source.clientSecret) }),
      ...(source.tokenProxyUrl === undefined
        ? {}
        : { tokenProxyUrl: httpsUrl(source.tokenProxyUrl) }),
    };
  }
  return {
    podRoot,
    webId,
    profileDocumentUrl:
      cfg.profileDocumentUrl === undefined ? profile.href : httpsUrl(cfg.profileDocumentUrl),
    oidcIssuer: httpsUrl(cfg.oidcIssuer),
    clientId: textValue(cfg.clientId),
    clientSecret: textValue(cfg.clientSecret),
    ...(cfg.tokenUrl === undefined ? {} : { tokenUrl: httpsUrl(cfg.tokenUrl) }),
    connectors,
  };
}
