// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Build the provider environment from OPERATOR options (CLI flags / server environment only):
 *  - `--provider-fixtures`: synthetic fixtures, no network;
 *  - `--provider-config FILE` (or AWP_PROVIDER_CONFIG): live adapters with the credential helper;
 *  - neither: no provider access (provider calendars report "needs setup").
 */

import type { Transport } from "../providers.js";
import { noTransport } from "../providers.js";
import type { ProviderEnvironment } from "./common.js";
import { HelperTokenProvider, loadProviderConfig } from "./credentials.js";
import { fixtureProviders } from "./fixtures.js";

const noNetwork: Transport = async () => {
  throw new Error("provider access is not configured");
};

export function providerEnvironment(options: {
  configPath?: string | undefined;
  transport?: Transport;
  fixtures?: boolean | undefined;
}): { providers: ProviderEnvironment; configuredConnections: string[] } {
  if (options.fixtures && options.configPath)
    throw new Error("choose either provider fixtures or a provider configuration, not both");
  if (options.fixtures) return { providers: fixtureProviders(), configuredConnections: [] };
  if (options.configPath) {
    const config = loadProviderConfig(options.configPath);
    return {
      providers: {
        mode: "live",
        transport: options.transport ?? noTransport,
        tokens: new HelperTokenProvider(config),
      },
      configuredConnections: config.accounts.map((a) => a.connectionId),
    };
  }
  return { providers: { mode: "none", transport: noNetwork }, configuredConnections: [] };
}
