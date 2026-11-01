// AUTHORED-BY Codex GPT-6.1-Sol
import type { Capabilities } from "@jeswr/suite-ui/sync";
import { redact, routePattern } from "./report-problem";
import { demoCapabilities } from "./settings-capabilities";
import { type Preferences, parsePreferences } from "./settings-preferences";

/** Allowlisted fields only; sanitise each string before encoding valid downloadable JSON. */
export function diagnostics({
  version,
  route,
  caps,
  preferences,
}: {
  version: string;
  route: string;
  caps: Capabilities;
  preferences: Preferences;
}): string {
  const safeCaps = Object.fromEntries(
    Object.entries(caps).filter(
      ([key, value]) => Object.hasOwn(demoCapabilities, key) && typeof value === "boolean",
    ),
  );
  return JSON.stringify(
    {
      version,
      route: routePattern(route),
      capabilities: safeCaps,
      preferences: parsePreferences(JSON.stringify(preferences)),
    },
    (_key, value: unknown) => (typeof value === "string" ? redact(value) : value),
    2,
  );
}
