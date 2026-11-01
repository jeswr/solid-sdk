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
import { abortablePodWriter, unlessAborted } from "./abort.js";
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
  /**
   * Cancels the run. Once it aborts, the runner starts no further source request, Pod read or
   * write, progress report, Type Index registration or provenance write, and rejects with its
   * reason; adapters that read `ctx.signal` also end waits (rate-limit backoff). The check runs
   * at the PodWriter boundary, immediately before each port call, so a cancel during a pending
   * read (a session's implicit read before a write, the provenance read in finalisation) still
   * stops the write that follows. Pass the same signal to `createFetchPodWriter` to check it
   * before every HTTP request inside a port and to abort requests in flight. A run whose
   * provenance write already finished is reported as complete.
   *
   * A cancelled run records no activity. Documents and items it already wrote keep
   * `prov:wasGeneratedBy` naming its activity IRI, which `_provenance.ttl` never describes:
   * read an activity missing from that document as a cancelled, incomplete run. The next run
   * that rewrites those documents or items links them to its own activity.
   */
  signal?: AbortSignal;
  /** Granted source permissions when the user withheld some (`ImportContext.scopes`). */
  scopes?: readonly string[];
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

  // Cancellation is enforced here for every adapter, whether or not it reads ctx.signal:
  // no source request, Pod read/write, registration or provenance step starts once aborted.
  // Pod I/O is checked at the writer boundary itself, so session-internal reads and writes
  // (including finalisation's provenance read and write) cannot slip past a cancel.
  const signal = opts.signal;
  const checked = <A extends unknown[], R>(step: (...args: A) => Promise<R>) =>
    unlessAborted(signal, step);
  const podWriter = abortablePodWriter(opts.podWriter, signal);
  signal?.throwIfAborted();
  const source = adapter.fixtures()[0]?.url;
  const session = createImportSession(
    podWriter,
    id,
    source ? `${new URL(source).origin}/` : `urn:solid:connector:${encodeURIComponent(id)}:source`,
    opts,
    adapter.vocabMap,
  );
  try {
    const outcome = await adapter.import({
      api: checked(api) as typeof fetch,
      cursor: opts.cursor ?? opts.state?.cursor,
      resolve: (slug) => opts.podWriter.resolve(slug),
      read: checked(session.read),
      progress: (p) => {
        signal?.throwIfAborted();
        opts.onProgress?.(p);
      },
      write: checked(session.write),
      writeBinary: checked(session.writeBinary),
      remove: checked(session.remove),
      signal,
      scopes: opts.scopes,
    });
    signal?.throwIfAborted();
    const { indexUrl } = await podWriter.registerType(session.registrations());
    signal?.throwIfAborted();
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
    // Partial writes already link to this run. Record it when storage is available and the
    // run was not cancelled, preserving the original failure if the provenance write fails.
    // A cancelled run starts no further Pod I/O, so its writes name an unrecorded activity
    // (documented on RunImportOptions.signal).
    if (signal?.aborted) session.release();
    else
      try {
        await session.finish();
      } catch {
        /* Original failure takes priority. */
      }
    opts.onState?.(session.state());
    // A cancel can surface as an adapter or write error; callers match the abort reason.
    throw signal?.aborted ? signal.reason : error;
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
