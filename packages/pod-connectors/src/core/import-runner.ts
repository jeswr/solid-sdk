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
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { registrationsFor } from "./pod-writer.js";
import type {
  ImportProgress,
  IntegrationAdapter,
  PodWriter,
  SourceAuth,
  TokenSet,
  WriteConditions,
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
  const readConditions = new Map<string, WriteConditions>();

  const outcome = await adapter.import({
    api,
    cursor: opts.cursor,
    resolve: (slug) => opts.podWriter.resolve(slug),
    read: async (slug) => {
      const existing = await opts.podWriter.read(slug);
      const url = opts.podWriter.resolve(slug);
      if (!existing) readConditions.set(url, { ifNoneMatch: "*" });
      else if (existing.etag) readConditions.set(url, { ifMatch: existing.etag });
      else readConditions.delete(url);
      return existing?.dataset;
    },
    progress: (p) => opts.onProgress?.(p),
    write: async (doc, conditions) => {
      const url = opts.podWriter.resolve(doc.slug);
      const w = await opts.podWriter.write(doc, conditions ?? readConditions.get(url));
      readConditions.delete(url);
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
  const origins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  const sourceFetch = refuseRedirects(fetchImpl);
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (!origins.has(url.origin) || url.username || url.password) {
      throw new IntegrationSyncError(
        adapterId,
        "Source request is outside the allowed API origins.",
      );
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("authorization", `Bearer ${token.accessToken}`);
    for (const [k, v] of Object.entries(adapter.apiHeaders ?? {})) headers.set(k, v);
    const next: RequestInit = { ...init, headers };
    return sourceFetch(input as RequestInfo, next);
  };
  return { fetch: impl as typeof fetch };
}
