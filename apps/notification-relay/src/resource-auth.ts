// AUTHORED-BY Codex GPT-6.1-Sol
import type { ResourceIdentity } from "@jeswr/solid-api-auth";
import { safeUrl } from "./signatures.js";

export { createResourceTokenVerifier, type ResourceIdentity } from "@jeswr/solid-api-auth";

/** Route-selected policies consume only a verified identity, never unverified token claims. */
export function mobileClientPolicy(clientId: string) {
  safeUrl(clientId);
  return (identity: ResourceIdentity): boolean => identity.clientId === clientId;
}

/** P6 supplies the sender from the stored topic; pod senders have no mobile-client rule. */
export function webhookSenderPolicy(sender: string) {
  return (identity: ResourceIdentity): boolean => identity.webid === sender;
}
