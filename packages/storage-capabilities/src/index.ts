// AUTHORED-BY Codex GPT-6.1-Sol
/** Storage capability contracts and CID parsing from ADR-002. */
export { capabilities } from "./capabilities.js";
export { CapabilitiesError } from "./errors.js";
export { deriveFeatures } from "./features.js";
export {
  LinkHeaderOverflowError,
  type ParsedLink,
  type ParseLinkHeadersOptions,
  parseLinkHeaders,
} from "./link.js";
export { parseLwsDescription } from "./lws-description.js";
export { probe } from "./probe.js";
export { parseWacAllow } from "./probe-headers.js";
export { resolveStorageDescription } from "./resolve.js";
export type {
  CapabilityEntry,
  DescriptionCache,
  DescriptionSource,
  Feature,
  FeatureState,
  Features,
  ProbeEvidence,
  ProbeResult,
  Protocol,
  ResolveOptions,
  ServiceEntry,
  StorageDescription,
  WacMode,
} from "./types.js";
