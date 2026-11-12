// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createOwnerJsonStore } from "./owner-json.js";
import { type ConnectorConnection, connectorConnections } from "./scheduler.js";
import { StateConflictError } from "./state.js";

/** Host-owned opaque connection settings, never credentials or arbitrary OAuth configuration. */
export function createConnectionStore(options: {
  readonly podRoot: string;
  readonly webId: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}) {
  const root = assertWithinPodScope(
    options.podRoot,
    new URL("integrations/", options.podRoot).href,
    { allowRoot: false },
  );
  const store = createOwnerJsonStore({
    ...options,
    root,
    url: new URL("connections.json", root).href,
    parse: connectorConnections,
    maxBytes: 262_144,
  });
  return {
    ...store,
    async update(connection: ConnectorConnection): Promise<void> {
      const [next] = connectorConnections([connection]);
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = (await store.read()) ?? [];
        let found = false;
        const merged = current.map((c) => {
          if (c.connectorId !== next?.connectorId || c.account !== next.account) return c;
          found = true;
          // Preserve a concurrent interval edit; this API changes only enablement/status.
          return { ...c, enabled: next.enabled, status: next.status };
        });
        if (!found) throw new Error("Connector connection was removed");
        try {
          await store.write(merged);
          return;
        } catch (error) {
          if (!(error instanceof StateConflictError) || attempt === 2) throw error;
        }
      }
    },
  };
}
