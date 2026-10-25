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
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { registrationsFor } from "./pod-writer.js";
import type {
  ImportProgress,
  IntegrationAdapter,
  PodWriter,
  SourceAuth,
  TokenSet,
  WrittenDoc,
} from "./types.js";

export type ImportMode = "live" | "demo";

export interface RunImportOptions {
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
  mode: ImportMode;
  written: WrittenDoc[];
  /** Distinct category ids that received data (for the success screen). */
  categories: string[];
  /** Cursor to persist for the next incremental import, if any. */
  cursor?: string;
  /** Items the adapter skipped because the live API sent a malformed shape. */
  skipped?: number;
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

  const written: WrittenDoc[] = [];

  const outcome = await adapter.import({
    api,
    cursor: opts.cursor,
    resolve: (slug) => opts.podWriter.resolve(slug),
    read: async (slug) => (await opts.podWriter.read(slug))?.dataset,
    progress: (p) => opts.onProgress?.(p),
    write: async (doc) => {
      const w = await opts.podWriter.write(doc);
      written.push(w);
      return w;
    },
  });

  const { indexUrl } = await opts.podWriter.registerType(registrationsFor(written));

  return {
    adapterId: id,
    mode,
    written,
    categories: [...new Set(written.map((w) => w.category))],
    cursor: outcome.cursor,
    skipped: outcome.skipped,
    indexUrl,
  };
}

/**
 * Live-mode source fetch: injects the bearer token + the adapter's static API
 * headers. The token goes to the platform's API host and nowhere else.
 */
export function createSourceAuth(
  adapterId: string,
  adapter: IntegrationAdapter,
  token: TokenSet | undefined,
  fetchImpl: typeof fetch,
): SourceAuth {
  if (!token) {
    throw new IntegrationSyncError(adapterId, "Live import requires a token — authorize first.");
  }
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token.accessToken}`);
    for (const [k, v] of Object.entries(adapter.apiHeaders ?? {})) headers.set(k, v);
    const next: RequestInit = { ...init, headers };
    return fetchImpl(input as RequestInfo, next);
  };
  return { fetch: impl as typeof fetch };
}
