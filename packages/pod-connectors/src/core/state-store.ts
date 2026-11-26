// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createOwnerJsonStore } from "./owner-json.js";
import { connectorState } from "./state.js";

/** Existing owner-only per-connector JSON resource; no Node or environment dependency. */
export function createConnectorStateStore(options: {
  readonly podRoot: string;
  readonly adapterId: string;
  readonly webId: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.adapterId)) throw new Error("Invalid connector id");
  const root = assertWithinPodScope(
    options.podRoot,
    new URL(`integrations/${options.adapterId}/`, options.podRoot).href,
    { allowRoot: false },
  );
  return createOwnerJsonStore({
    ...options,
    root,
    url: new URL("state.json", root).href,
    parse: connectorState,
  });
}
