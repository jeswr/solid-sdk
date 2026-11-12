// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createOwnerJsonStore } from "./owner-json.js";
import {
  type ConnectionSaveResult,
  type ConnectorConnection,
  connectorConnections,
} from "./scheduler.js";
import { MAX_CONNECTIONS, StateConflictError } from "./state.js";
import { ConnectionRemovedError } from "./types.js";

/**
 * The settings document is a bounded JSON array. Rows are validated individually by
 * `parseConnectorConnections`, so one malformed row never rejects the list, and rows this
 * version cannot interpret are preserved verbatim when another row is updated.
 */
export function connectionRows(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_CONNECTIONS)
    throw new Error("Invalid connector connections");
  return value;
}
function normalisedEnabledAt(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value)))
    return null;
  return new Date(value).toISOString();
}
const isRow = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

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
    parse: connectionRows,
    maxBytes: 262_144,
  });
  return {
    url: store.url,
    /** Changes only when a read observes new content (conditional GET on the last ETag). */
    get revision(): number {
      return store.revision;
    },
    read: (signal?: AbortSignal) => store.read(signal),
    /** Read-only listing: no ACL or data writes. */
    peek: (signal?: AbortSignal) => store.peek(signal),
    write: (rows: readonly unknown[], signal?: AbortSignal) => store.write(rows, signal),
    /**
     * Change only enablement, status and (when given) `enabledAt` of one row, merging
     * concurrent edits on 412. A missing row throws ConnectionRemovedError. A needs-reauth
     * disable (`enabled: false, status: 'needs-reauth'`) is conditional: it applies only
     * while the row's `enabledAt` equals `connection.enabledAt` (both absent counts as
     * equal); otherwise the owner re-enabled during the run, the row is left unchanged and
     * the result is `"superseded"`. Every applied write resolves `"applied"`.
     */
    async update(
      connection: ConnectorConnection,
      signal?: AbortSignal,
    ): Promise<ConnectionSaveResult> {
      const [next] = connectorConnections([connection]);
      if (!next) throw new Error("Invalid connector connection");
      const latching = !next.enabled && next.status === "needs-reauth";
      for (let attempt = 0; ; attempt++) {
        const current = (await store.read(signal)) ?? [];
        let found = false;
        let superseded = false;
        const merged = current.map((row) => {
          if (!isRow(row) || row.connectorId !== next.connectorId || row.account !== next.account)
            return row;
          found = true;
          // A needs-reauth disable applies only while the row still carries the enabledAt
          // the latch recorded; a changed value is the owner's re-enable and is kept.
          if (latching && normalisedEnabledAt(row.enabledAt) !== next.enabledAt) {
            superseded = true;
            return row;
          }
          // Preserve a concurrent interval edit and any fields this version does not know.
          const kept = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "status"));
          return {
            ...kept,
            enabled: next.enabled,
            ...(next.status === undefined ? {} : { status: next.status }),
            ...(next.enabledAt === undefined ? {} : { enabledAt: next.enabledAt }),
          };
        });
        if (!found) throw new ConnectionRemovedError();
        // A superseded row is returned as is and no other row changes: nothing to write.
        if (superseded) return "superseded";
        try {
          await store.write(merged, signal);
          return "applied";
        } catch (error) {
          if (!(error instanceof StateConflictError) || attempt === 2) throw error;
        }
      }
    },
  };
}
