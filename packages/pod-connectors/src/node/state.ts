// AUTHORED-BY Codex GPT-6.1-Sol
import { createConnectorStateStore } from "../core/state-store.js";
import type { ConnectorState } from "../core/types.js";
import { NodeRuntimeError } from "./errors.js";

export { connectorState } from "../core/state.js";

/** Compatibility CLI wrapper; preserve scrubbed Node diagnostics and fail on conflicts. */
export function createStateStore(options: Parameters<typeof createConnectorStateStore>[0]) {
  if (!/^[a-z0-9-]+$/.test(options.adapterId))
    throw new NodeRuntimeError("config", "Invalid connector id.");
  const store = createConnectorStateStore(options);
  return {
    url: store.url,
    async read(): Promise<ConnectorState | undefined> {
      try {
        return await store.read();
      } catch {
        throw new NodeRuntimeError("import", "Cannot read or protect connector state.");
      }
    },
    async write(state: ConnectorState): Promise<void> {
      try {
        await store.write(state);
      } catch {
        throw new NodeRuntimeError("import", "Cannot save connector state.");
      }
    },
  };
}
