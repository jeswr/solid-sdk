// AUTHORED-BY Claude Opus 5.5
/**
 * The fixed public read configuration. A configuration is chosen for the main exchange; a
 * lookup against a public service (an index, a register, a trust root) uses this one instead:
 * no identifier for the asker, by query, signed answers (model configurationNote). It
 * differs from the baseline in two layers only, and is carried as the pilot's
 * public-readonly configuration.
 */
import { CONFIG_PUBLIC } from "../profile/configurations.js";
import { BASELINE } from "./baseline.js";
import type { Configuration, SuiteRegistry } from "./registry.js";

export const PUBLIC_READ_SUITES = {
  identity: {
    layer: "identity",
    id: "anonymous",
    name: "No identifier",
    summary:
      "The asker sends unsigned requests with no identifier; only the answering service is named, by its pinned key.",
    resolution: "none",
  },
  "data-access": {
    layer: "data-access",
    id: "by-query",
    name: "By query",
    summary: "The asker sends a query and gets back only the matching records.",
    mode: "by-query",
  },
} as const;

/** Public read: the baseline with an anonymous asker and access by query; answers stay signed. */
export const PUBLIC_READ: Configuration = {
  id: "public-read",
  pilotConfiguration: CONFIG_PUBLIC,
  layers: {
    ...BASELINE.layers,
    identity: PUBLIC_READ_SUITES.identity.id,
    "data-access": PUBLIC_READ_SUITES["data-access"].id,
  },
};

/** Add the public read suites and configuration to a registry holding the baseline. */
export function withPublicRead(registry: SuiteRegistry): SuiteRegistry {
  for (const suite of Object.values(PUBLIC_READ_SUITES)) registry.register(suite);
  registry.configure(PUBLIC_READ);
  return registry;
}
