// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { connectorStateLocation } from "./container.js";
import { createOwnerJsonStore, type PrivateDestinationChecks } from "./owner-json.js";
import { requiresPrivateDestination } from "./pod-writer-policy.js";
import { connectorState } from "./state.js";

export { connectorStateLocation } from "./container.js";
export type { PrivateDestinationChecks } from "./owner-json.js";

/**
 * Existing owner-only per-connector JSON resource; no Node or environment dependency.
 * It shares the CLI checkpoint's location (`connectorStateLocation`) and parser.
 *
 * A private connector (every registered one, and any unclassified id) needs
 * `privateDestination`: the host's verifyPrivateDestination/confirmPrivateWrite ports,
 * normally the same checks its PodWriter carries (`createOwnerOnlyDestinationChecks` or
 * `createSessionPrivateDestinationChecks`). Without them every mutation (the ACL install
 * on first read, and each write) refuses with PrivateDestinationError before any request.
 */
export function createConnectorStateStore(options: {
  readonly podRoot: string;
  readonly adapterId: string;
  readonly webId: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
  readonly privateDestination?: PrivateDestinationChecks;
}) {
  const { privateDestination: checks, ...rest } = options;
  const { root, url } = connectorStateLocation(rest.podRoot, rest.adapterId);
  return createOwnerJsonStore({
    ...rest,
    root,
    url,
    parse: connectorState,
    ...(requiresPrivateDestination(rest.adapterId) && {
      privateDestination: { id: rest.adapterId, checks },
    }),
  });
}
