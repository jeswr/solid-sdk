// AUTHORED-BY Claude Opus 5.5
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
import { RunBudget, type RunLimits, stricterLimits } from "./budget.js";
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch } from "./fixture-fetch.js";
import { createImportSession } from "./import-session.js";
import { budgetedFetch } from "./source-budget.js";
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
  /** Total source requests, records and response bytes; shared across pages, retries and fallbacks. */
  limits?: Partial<RunLimits>;
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
   * before every HTTP request inside a port and to abort requests in flight. A run cancelled
   * before it resolves is reported as cancelled, even when the cancel lands while the final
   * provenance write is in flight (that write may still complete). Once the run has reported
   * its state through `onState`, it resolves successfully; a cancel then only stops the
   * adapter's best-effort `ImportOutcome.commit` cleanup.
   *
   * The run deadline (`limits.maxDurationMs`) bounds source work only. It permits Pod
   * checkpoint writes after it expires, and once the adapter has resolved it no longer fails
   * the run: registration and provenance still complete so the new cursor is reported.
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
  opts.signal?.throwIfAborted();
  const limits = stricterLimits(adapter.limits, opts.limits);
  const budget = new RunBudget(id, limits);
  let timeout: AbortSignal | undefined;
  const deadline = new AbortController();
  const expire = () => {
    if (budget.remainingMs > 0) armDeadline();
    else deadline.abort(budget.expire());
  };
  const armDeadline = () => {
    // Native timers have a finite range; long host allowances must not expire early.
    timeout = AbortSignal.timeout(Math.min(Math.ceil(budget.remainingMs), 2_147_483_647));
    timeout.addEventListener("abort", expire, { once: true });
  };
  armDeadline();
  const signal = AbortSignal.any([...(opts.signal ? [opts.signal] : []), deadline.signal]);
  const sourceApi = budgetedFetch(api, id, budget, signal);
  // Source deadlines stop upstream work; completed data may still be checkpointed to the Pod.
  // Explicit user cancellation continues to stop every Pod operation at its boundary.
  const checked = <A extends unknown[], R>(step: (...args: A) => Promise<R>) =>
    unlessAborted(opts.signal, step);
  const podWriter = abortablePodWriter(opts.podWriter, opts.signal);
  let session: ReturnType<typeof createImportSession>;
  try {
    signal.throwIfAborted();
    const source = adapter.fixtures()[0]?.url;
    session = createImportSession(
      podWriter,
      id,
      source
        ? `${new URL(source).origin}/`
        : `urn:solid:connector:${encodeURIComponent(id)}:source`,
      opts,
      adapter.vocabMap,
    );
  } catch (error) {
    sourceApi.close();
    timeout?.removeEventListener("abort", expire);
    throw error;
  }
  // Set once adapter.import resolves: source work is over, so the run deadline no longer applies.
  let imported = false;
  try {
    budget.checkTime();
    const outcome = await adapter.import({
      api: sourceApi.api,
      budget,
      cursor: opts.cursor ?? opts.state?.cursor,
      resolve: (slug) => opts.podWriter.resolve(slug),
      read: checked(session.read),
      // Progress stops only on caller cancellation; the deadline is enforced on source I/O.
      progress: (p) => {
        opts.signal?.throwIfAborted();
        opts.onProgress?.(p);
      },
      write: checked(session.write),
      writeBinary: checked(session.writeBinary),
      remove: checked(session.remove),
      signal,
      scopes: opts.scopes,
      limits,
    });
    imported = true;
    // The adapter has committed its data and checkpoints. The source deadline is not a
    // reason to discard them: only the caller's cancellation stops finalisation now.
    opts.signal?.throwIfAborted();
    const { indexUrl } = await podWriter.registerType(session.registrations());
    opts.signal?.throwIfAborted();
    let state: ConnectorState | undefined;
    await session.finish(async () => {
      // A cancel during the final provenance write is still a cancel: never report success.
      opts.signal?.throwIfAborted();
      state = session.state(outcome);
      opts.onState?.(state);
      // The run is committed and its cursor reported. Only now may the adapter discard
      // private resume state that the cursor supersedes; a failure or cancel leaves it.
      try {
        await outcome.commit?.();
      } catch {
        /* Best-effort: the reported checkpoint stands. */
      }
    });
    if (!state) throw new IntegrationSyncError(id, "Import did not report its state.");
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
    if (opts.signal?.aborted) session.release();
    else
      try {
        await session.finish();
      } catch {
        /* Original failure takes priority. */
      }
    opts.onState?.(session.state());
    // A cancel can surface as an adapter or write error; callers match the abort reason.
    if (opts.signal?.aborted) throw opts.signal.reason;
    throw !imported && signal.aborted ? signal.reason : error;
  } finally {
    sourceApi.close();
    timeout?.removeEventListener("abort", expire);
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
