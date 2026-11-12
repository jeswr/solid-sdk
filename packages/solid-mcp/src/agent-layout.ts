// AUTHORED-BY Codex GPT-6.1-Sol
/** Conventional owner-only agent layout (ADR 0004 and agent-registry). */
export const SHARED_CONTEXT_CONTAINER = "agent/context/";
/** Conventional location of the shared-context document, relative to the pod root. */
export const SHARED_CONTEXT_PATH = `${SHARED_CONTEXT_CONTAINER}shared-context.md`;
const AGENT_MEMORY_CONTAINER = "agent/memory/";
/**
 * Health facts sit in their own container so that their ACL and mandate scope can differ from
 * other memory (ADR 0004). It lies inside agent/memory/, so generic operations already refuse
 * it, but its own advertised ACL/metadata can live anywhere in the pod and must be discovered.
 */
export const AGENT_HEALTH_CONTAINER = `${AGENT_MEMORY_CONTAINER}health/`;
const AGENT_ACCOUNTS_CONTAINER = "agent/accounts/";

/** All generic operations reserve these areas, including their ACL/metadata aliases. */
export const PROTECTED_AGENT_CONTAINERS = [
  SHARED_CONTEXT_CONTAINER,
  AGENT_MEMORY_CONTAINER,
  AGENT_ACCOUNTS_CONTAINER,
] as const;

/** Protected areas whose own auxiliary associations each mutation rediscovers. */
export const INDEPENDENTLY_GOVERNED_AGENT_CONTAINERS = [
  ...PROTECTED_AGENT_CONTAINERS,
  AGENT_HEALTH_CONTAINER,
] as const;
