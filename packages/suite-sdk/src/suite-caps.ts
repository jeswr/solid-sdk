// AUTHORED-BY Claude Opus 5.5
import type { Feature, Features } from "@jeswr/storage-capabilities";

/** Boolean capability view the suite apps gate UI on (00-sdk-assumptions §3). */
export interface SuiteCaps {
  protocol: "solid" | "lws";
  accessControl: "wac" | "acp" | "odrl-grants" | "none";
  realtimeCollab: boolean;
  liveUpdates: boolean;
  serverSearch: boolean;
  accessRequests: boolean;
  versioning: boolean;
  trash: boolean;
  /** Always false in the first cut: no storage advertises a quota service. */
  quota: boolean;
  /** Native move; false means the storage client emulates it with copy and delete. */
  move: boolean;
  resumableUploads: boolean;
  /** An "anyone with the link" grant is expressible. */
  publicLinks: boolean;
  /** An "anyone signed in" grant is expressible. */
  authenticatedAgentGrants: boolean;
  grantExpiry: boolean;
  grantPurpose: boolean;
  /** A notification can be delivered to another agent (LDN; still checked per recipient). */
  notifyAgents: boolean;
  typeIndex: boolean;
  /** The configured provider can create an account, storage and WebID. */
  selfRegistration: boolean;
  /** Patch media types the storage accepts for any resource type, de-duplicated. */
  patchMediaTypes: string[];
}

/** Facts that are not storage features. */
export interface SuiteCapsContext {
  /** The active identity has an `ldp:inbox`, so Solid access requests can be received. */
  hasInbox?: boolean;
  /** `useRegistration().available` for the configured provider. */
  selfRegistration?: boolean;
}

function available(feature: Feature<unknown>): boolean {
  return feature.state === "available";
}

/**
 * Derives the boolean `SuiteCaps` from the tri-state `Features` (ADR-002). Every boolean is
 * `state === "available"`; unknown and unavailable are both false (fail closed, A-6).
 */
export function deriveSuiteCaps(features: Features, context: SuiteCapsContext = {}): SuiteCaps {
  const model = available(features.accessControl) ? features.accessControl.detail.model : "none";
  const solid = features.protocol === "solid";
  const patchMediaTypes = available(features.patch)
    ? [...new Set(Object.values(features.patch.detail.formats).flat())]
    : [];
  return {
    protocol: features.protocol,
    accessControl: model,
    realtimeCollab: available(features.realtimeCollab),
    liveUpdates: available(features.liveUpdates),
    serverSearch: available(features.serverSearch),
    accessRequests: available(features.accessRequests) || (solid && context.hasInbox === true),
    versioning: available(features.versioning),
    trash: available(features.trash),
    quota: false,
    move: available(features.move) && features.move.detail.native,
    resumableUploads: available(features.resumableUploads),
    publicLinks: model === "wac" || model === "acp",
    authenticatedAgentGrants: model === "wac" || model === "acp",
    grantExpiry: model === "odrl-grants",
    grantPurpose: model === "odrl-grants",
    notifyAgents: solid,
    typeIndex: available(features.typeIndex),
    selfRegistration: context.selfRegistration === true,
    patchMediaTypes,
  };
}
