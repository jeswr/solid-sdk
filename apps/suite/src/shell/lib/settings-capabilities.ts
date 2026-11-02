// AUTHORED-BY Codex GPT-6.1-Sol
import type { Capabilities, CapabilityKey } from "@jeswr/suite-ui/sync";

const features = [
  ["realtimeCollab", "Live co-editing"],
  ["liveUpdates", "Live updates"],
  ["serverSearch", "Search"],
  ["accessRequests", "Access requests"],
  ["versioning", "Version history"],
  ["trash", "Trash"],
  ["publicLinks", "Link sharing"],
  ["grantExpiry", "Expiring access"],
  ["move", "Move"],
] as const satisfies readonly (readonly [CapabilityKey, string])[];

export const demoCapabilities: Capabilities = {
  realtimeCollab: false,
  liveUpdates: false,
  serverSearch: false,
  accessRequests: false,
  versioning: false,
  trash: true,
  publicLinks: false,
  grantExpiry: false,
  move: true,
  grantPurpose: false,
  authenticatedAgentGrants: false,
  notifyAgents: false,
  selfRegistration: false,
};

export function capabilityRows(caps: Capabilities) {
  return features.map(([key, label]) => ({ key, label, value: caps[key] === true ? "Yes" : "No" }));
}

export function demoCapabilitiesWith(
  overrides: Partial<Record<CapabilityKey, boolean | undefined>>,
): Capabilities {
  return {
    ...demoCapabilities,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  };
}
