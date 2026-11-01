// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * The import runner — the one place integration data enters the pod.
 *
 *   adapter.import() → ctx.write(doc) → pod-data.writeResource (PUT Turtle)
 *   …then ensureTypeRegistrations so the data appears under My data.
 *
 * Demo vs live is decided here: demo wires the adapter's fixtures through the
 * typed fake fetch; live wraps the real fetch with the (in-memory) token.
 * Documents land at `<podRoot>integrations/<adapterId>/<slug>` — deterministic
 * URLs, so a re-import overwrites in place (idempotent).
 */
import { refuseRedirects, snapshotFetchInput } from "@jeswr/guarded-fetch";
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { createImportSession } from "./import-session.js";
import type {
  ConnectorState,
  ConnectorStateOptions,
  ImportProgress,
  IntegrationAdapter,
  PodWriter,
  SourceAuth,
  TokenSet,
  WrittenDoc,
} from "./types.js";

export type ImportMode = "live" | "demo";

export interface RunImportOptions extends ConnectorStateOptions {
  adapter: IntegrationAdapter;
  /** Explicit, host-owned storage port for this adapter. */
  podWriter: PodWriter;
  mode: ImportMode;
  /** Required for live mode; already authenticated by the host. */
  sourceAuth?: SourceAuth;
  /** Cursor from the previous import (incremental, where supported). */
  cursor?: string;
  onProgress?: (p: ImportProgress) => void;
}

export interface ImportReport {
  adapterId: string;
  /** Updated host-owned checkpoint; persist only in the host. */
  state?: ConnectorState;
  mode: ImportMode;
  written: WrittenDoc[];
  /** Distinct category ids that received data (for the success screen). */
  categories: string[];
  /** Cursor to persist for the next incremental import, if any. */
  cursor?: string;
  /** Items the adapter skipped because the live API sent a malformed shape. */
  skipped?: number;
  /** Unsupported export products or formats, grouped by product folder. */
  unsupported?: readonly string[];
  /** The type-index document used/created. */
  indexUrl: string;
}

/** Root container for one adapter's documents. */
export function adapterContainerUrl(podRoot: string, adapterId: string): string {
  return new URL(`integrations/${adapterId}/`, podRoot).toString();
}

export async function runImport(opts: RunImportOptions): Promise<ImportReport> {
  const { adapter, mode } = opts;
  const id = adapter.metadata.id;

  const api = mode === "demo" ? fixtureFetch(id, adapter.fixtures()) : opts.sourceAuth?.fetch;
  if (!api)
    throw new IntegrationSyncError(id, "Live import requires SourceAuth — authorize first.");

  const source = adapter.fixtures()[0]?.url;
  const session = createImportSession(
    opts.podWriter,
    id,
    source ? `${new URL(source).origin}/` : `urn:solid:connector:${encodeURIComponent(id)}:source`,
    opts,
    adapter.vocabMap,
  );
  try {
    const outcome = await adapter.import({
      api,
      cursor: opts.cursor ?? opts.state?.cursor,
      resolve: (slug) => opts.podWriter.resolve(slug),
      read: session.read,
      progress: (p) => opts.onProgress?.(p),
      write: session.write,
      writeBinary: session.writeBinary,
      remove: session.remove,
    });
    const { indexUrl } = await opts.podWriter.registerType(session.registrations());
    await session.finish();
    const state = session.state(outcome);
    opts.onState?.(state);
    return {
      adapterId: id,
      mode,
      written: session.written,
      categories: [...new Set(session.written.map((w) => w.category))],
      cursor: state.cursor,
      skipped: outcome.skipped,
      indexUrl,
      state,
    };
  } catch (error) {
    // Partial writes already link to this run. Record it when storage is available,
    // preserving the original failure if the provenance write also fails.
    try {
      await session.finish();
    } catch {
      /* Original failure takes priority. */
    }
    opts.onState?.(session.state());
    throw error;
  }
}

/**
 * Live-mode source fetch: injects the bearer token + the adapter's static API
 * headers. Only allowlisted API origins receive credentials; redirects are refused.
 * Defaults to the adapter's static recorded fixture origins. Hosts can provide an
 * explicit origin list for APIs not represented by those routes.
 */
export function createSourceAuth(
  adapterId: string,
  adapter: IntegrationAdapter,
  token: TokenSet | undefined,
  fetchImpl: typeof fetch,
  allowedOrigins: readonly string[] = adapter.fixtures().map((route) => new URL(route.url).origin),
): SourceAuth {
  if (!token) {
    throw new IntegrationSyncError(adapterId, "Live import requires a token — authorize first.");
  }
  const origins = new Set(
    allowedOrigins.map((origin) => {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new IntegrationSyncError(
          adapterId,
          "Source API origins must use HTTPS without userinfo.",
        );
      }
      return url.origin;
    }),
  );
  const sourceFetch = refuseRedirects(fetchImpl);
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Main read headers directly before spreading init. Preserve both reads when headers
    // is enumerable, and the direct lookup for inherited/non-enumerable headers.
    const explicitHeaders = init?.headers;
    const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "spread" });
    const url = new URL(snapshot.url);
    if (url.protocol !== "https:" || !origins.has(url.origin) || url.username || url.password) {
      throw new IntegrationSyncError(
        adapterId,
        "Source request is outside the allowed API origins.",
      );
    }
    const headers = new Headers(
      explicitHeaders ?? (typeof snapshot.input === "string" ? undefined : snapshot.input.headers),
    );
    headers.set("authorization", `Bearer ${token.accessToken}`);
    for (const [k, v] of Object.entries(adapter.apiHeaders ?? {})) headers.set(k, v);
    const next: RequestInit = { ...snapshot.init, headers };
    return sourceFetch(snapshot.input, next);
  };
  return { fetch: impl as typeof fetch };
}
