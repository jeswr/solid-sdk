// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2
/**
 * The integration adapter contract (docs/integrations-catalog.md §"The common
 * adapter shape"). An adapter pulls a user's data from a platform API,
 * normalises it to RDF with standard vocabularies (via the typed wrappers in
 * `vocab.ts` — never inline quads), and writes it into the pod through the
 * import runner.
 */
import type { DatasetCore } from "@rdfjs/types";
import type { RunBudget, RunLimits } from "./budget.js";

/** Catalog tiers (docs/integrations-catalog.md). Tier B includes approval-gated and CLI-only sources. */
export type IntegrationTier = "A" | "B" | "C";

/** How the user connects. */
export type AuthKind =
  | "oauth-pkce" // end-user OAuth2 authorization-code + PKCE in a popup
  | "export-file" // Tier C: parse the platform's official data export
  | "account-cli" // unofficial account API; Node CLI only
  | "none"; // metadata-only catalog entry (Tier B placeholder)

/** Static, render-ready description of an integration. No RDF, no I/O. */
export interface IntegrationMetadata {
  /** Retired live API; message identifies the successor. Retained for stored/demo connections. */
  readonly deprecated?: string;
  /** Stable catalog id; URL-safe (used in routes + container paths). */
  readonly id: string;
  readonly name: string;
  readonly tier: IntegrationTier;
  readonly authKind: AuthKind;
  /** Live account access requires the Node CLI; requirements contain the how-to. */
  readonly cliOnly?: boolean;
  /** OAuth scopes requested (empty for non-OAuth kinds). */
  readonly scopes: readonly string[];
  /** Category ids (`src/lib/categories.ts`) this integration writes into. */
  readonly categories: readonly string[];
  /** Plain-language "what you get" copy for the connect screen. */
  readonly whatYouGet: string;
  /** Honest go-live notes: what the maintainer must register/deploy. */
  readonly requirements: readonly string[];
  /** Registry scheduling default for API connectors; hosts may override (minimum 15). */
  readonly defaultIntervalMinutes?: number;
}

/** OAuth2 endpoints + per-app parameters for the shared PKCE engine. */
export interface OAuthAppConfig {
  /**
   * Public client id injected by the host. Absent means demo-only.
   */
  readonly clientId?: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** OAuth scopes to request (usually the same array as `metadata.scopes`). */
  readonly scopes: readonly string[];
  /**
   * `"public"`: the platform exchanges code→token for secretless PKCE clients.
   * `"proxy"`: the platform insists on a client secret, so the exchange goes
   * through the maintainer-deployed proxy at `tokenProxyUrl`
   *. Without it the adapter stays demo.
   */
  readonly tokenExchange: "public" | "proxy";
  readonly tokenProxyUrl?: string;
  /** Optional installed-app secret injected by a Node host; never persist or expose in a UI. */
  readonly clientSecret?: string;
  /**
   * Direct Node exchange with a local client secret: form-post secret by default,
   * or HTTP Basic client authentication with a form or JSON body.
   * Proxies keep their form contract.
   */
  readonly tokenRequest?: "form" | "basic-form" | "basic-json";
  /** Node loopback login requires a fixed, provider-registered callback port. */
  readonly requiresCallbackPort?: boolean;
  /** Extra query params some platforms require on the authorize URL. */
  readonly extraAuthParams?: Readonly<Record<string, string>>;
  /**
   * Send `Authorization: Basic base64(client_id + ":")` on the token request
   * (Reddit's installed-app convention for secretless clients).
   */
  readonly basicAuthForToken?: boolean;
  /**
   * RFC 7009 revocation endpoint. When present, disconnect makes a best-effort revocation of
   * the refresh credential before deleting it locally; otherwise revocation is manual.
   */
  readonly revocationEndpoint?: string;
}

/** Access tokens stay in memory; only refresh credentials may enter an injected vault. */
export interface TokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string;
  /** Epoch ms when the access token expires, when the platform said. */
  readonly expiresAt?: number;
  /**
   * Space-delimited scopes the platform granted (RFC 6749 §5.1 `scope`), when it said.
   * Source auth exposes them as `SourceAuth.scopes`, which runImport passes on as `ctx.scopes`.
   */
  readonly scope?: string;
}

/** One normalised document the adapter wants written into the pod. */
export interface NormalisedDoc {
  /** Optional hard UTF-8 Turtle cap, enforced after session provenance and vocabulary mapping. */
  readonly maxSerializedBytes?: number;
  /**
   * Path under the adapter's root container, e.g. `"music/top-tracks.ttl"`.
   * Deterministic slugs ⇒ idempotent re-imports (overwrite, never duplicate).
   */
  readonly slug: string;
  /** Category id this document belongs to (for reporting + success copy). */
  readonly category: string;
  /** RDF class to register in the Type Index for the document's container. */
  readonly forClass: string;
  /**
   * Further RDF classes the document holds, registered for the same container (for example
   * health observations kept beside the workouts they describe).
   */
  readonly additionalClasses?: readonly string[];
  /** The document content, built via the typed vocab wrappers. */
  readonly dataset: DatasetCore;
  /**
   * Replace the document by default (snapshot semantics). Use "merge" for incremental
   * pages: incoming deterministic subjects replace their descriptions; absent subjects survive.
   */
  readonly writeMode?: "replace" | "merge";
  /** Refuse an existing resource without a strong ETag before a read-modify-write. */
  readonly requirePrecondition?: boolean;
  /** Source document for items without their own schema:url (e.g. file exports). */
  readonly sourceUrl?: string;
  /**
   * Register `forClass` for this ancestor container slug (ending in `/`) instead of the
   * document's own container, e.g. a mail account root holding `messages/` and `threads/`.
   */
  readonly registrationContainer?: string;
  /**
   * Skip Type-Index registration for this doc's class (default false). Used
   * for companion documents that ride along in an already-registered
   * container (e.g. a profile doc beside the repositories collection).
   */
  readonly skipRegistration?: boolean;
  /**
   * Absolute IRIs of subjects copied unchanged from the stored document rather than imported
   * by this run (for example playlists a partial grant cannot see). They are written but
   * excluded from the run's item counts.
   */
  readonly carriedForward?: readonly string[];
}

/**
 * A non-RDF resource. `"create"` keeps an existing resource (source-immutable content keyed
 * by a stable id, e.g. a mail message); `"replace"` overwrites it under its current ETag.
 */
export interface BinaryDoc {
  /** Path under the adapter's root container, e.g. `"mail/acct/messages/id.eml"`. */
  readonly slug: string;
  /** Media type sent as `Content-Type`; RDF media types are refused (use `write`). */
  readonly contentType: string;
  readonly body: Uint8Array;
  /** Default `"create"`. */
  readonly mode?: "create" | "replace";
}

/** A binary resource the writer stored (`created: false` when `"create"` kept an existing one). */
export interface WrittenBinary {
  readonly url: string;
  readonly created: boolean;
  /** Whether a completed binary write used a create-only precondition. */
  readonly writeCreated?: boolean;
  /** ETag from the write response, when available for private-destination cleanup. */
  readonly writeEtag?: string;
}

/** A doc the runner wrote, with its final URL. */
export interface WrittenDoc {
  readonly url: string;
  /** Whether the completed write used a create-only precondition. */
  readonly writeCreated?: boolean;
  /** ETag from the write response, when available for private-destination cleanup. */
  readonly writeEtag?: string;
  /** Validator returned by this write, when available (never a later read's validator). */
  readonly etag?: string | null;
  readonly category: string;
  readonly forClass: string;
  /** Further classes registered for the same container as `forClass`. */
  readonly additionalClasses?: readonly string[];
  readonly skipRegistration?: boolean;
  /** Absolute container registered instead of the document's own container. */
  readonly registrationContainer?: string;
}

export interface ImportProgress {
  /** Plain-language step label ("Fetching your top tracks…"). */
  readonly label: string;
  /** Steps completed so far. */
  readonly done: number;
  /** Total steps, when known up front. */
  readonly total?: number;
}

/** What the runner hands an adapter's `import()`. */
export interface ImportContext {
  /** Runner-owned shared source budget; adapters charge every returned record with items(). */
  readonly budget: RunBudget;
  /** Effective limits; factory and host settings are merged per key using the stricter value. */
  readonly limits?: Partial<RunLimits>;
  /**
   * Fetch against the **source platform**: token-injected when live,
   * fixture-backed in demo mode and contract tests. Adapters must do all API
   * I/O through this — never the global fetch (that one is pod-auth-patched).
   */
  readonly api: typeof fetch;
  /** Resolve a slug to the absolute pod URL it will be written at (for fragment IRIs). */
  resolve(slug: string): string;
  /**
   * Read a previously-written document back (for incremental imports that
   * merge new items into an existing collection). `undefined` when absent.
   * An optional inspection can reject the stored dataset before the session retains a copy.
   */
  read(slug: string, inspect?: (dataset: DatasetCore) => void): Promise<DatasetCore | undefined>;
  /** Release a read-only dataset/precondition when no write will follow. A later write re-reads.
   * Hosts without retained read state may omit this port. It performs no Pod I/O. */
  releaseRead?(slug: string): void;
  /** Write RDF; defaults to the precondition retained by a preceding read of this URL. */
  write(doc: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc>;
  /**
   * Write a non-RDF resource (original file, `.eml` source, attachment) inside the
   * adapter container. Throws `IntegrationSyncError` when the host writer has no binary port.
   */
  writeBinary(doc: BinaryDoc): Promise<WrittenBinary>;
  /**
   * Delete a resource the source deleted (RDF or binary). Missing resources are not an
   * error. Throws `IntegrationSyncError` when the host writer has no delete port.
   */
  remove(slug: string): Promise<void>;
  /** Report progress to the UI. */
  progress(p: ImportProgress): void;
  /** Incremental cursor from the previous import of this adapter, if any. */
  readonly cursor?: string;
  /**
   * Combines caller cancellation and the source run deadline. Both stop source requests and
   * in-flight waits (for example on a rate-limit delay). Caller cancellation also refuses
   * subsequent Pod reads/writes/removals and progress; deadline expiry permits saving completed
   * data and private journals before failing without advancing the successful checkpoint.
   * A caller-cancelled run records no activity, so documents it
   * already wrote name an activity absent from `_provenance.ttl` (see `RunImportOptions.signal`).
   */
  readonly signal?: AbortSignal;
  /**
   * Source permissions the user granted for this run; undefined means every `metadata.scopes`
   * entry. runImport takes `RunImportOptions.scopes`, else the live `SourceAuth.scopes` (the
   * token's granted `scope`). Advisory: only adapters that opt in read it. Spotify omits playlists of a withheld
   * kind and keeps what earlier runs imported under it. Google Health requires every requested
   * Health scope and refuses partial grants before a source request. Other adapters ignore it,
   * so hosts that let users withhold scopes must gate their requests and documents themselves.
   */
  readonly scopes?: readonly string[];
}

/** What `import()` returns (documents are reported by the runner). */
export interface ImportOutcome {
  /** Actionable notices, including a successfully saved partial batch. Fixed adapter
   * strings only: never provider-supplied text (hosts print them). */
  readonly warnings?: readonly string[];
  /** Stable, non-personal codes for recoverable failures. */
  readonly errors?: readonly string[];
  /** Opaque incremental cursor for the next import, where the API supports it. */
  readonly cursor?: string;
  /**
   * Count of source items the adapter had to skip because the live API sent a
   * malformed/incomplete shape (a null array entry, or an item missing the one
   * field it cannot exist without — e.g. a stable id for its fragment IRI). One
   * bad item is skipped, never fatal; this is how the count surfaces honestly to
   * the UI. Omitted (undefined) when nothing was skipped.
   */
  readonly skipped?: number;
  /**
   * Discards private resume state (a full-sync journal) that `cursor` supersedes. The runner
   * calls it once, after the run has recorded provenance and reported its successful state,
   * while the run still holds the connector. Best-effort: a failure or a caller cancellation
   * leaves that state in place, so it must be safe to resume from it again.
   */
  readonly commit?: () => Promise<void>;
  /** Source fields or products without a supported vocabulary mapping. */
  readonly unsupported?: readonly string[];
}

/** One recorded fixture route for the typed fake fetch.
 * Entries sharing a method and URL replay in array order, then fail on exhaustion.
 * A single entry for a method/URL remains reusable for static demos.
 */
export interface FixtureRoute {
  /** HTTP method (default GET). */
  readonly method?: string;
  /** URL prefix on the same origin and complete path segments; longest match wins. */
  readonly url: string;
  /** JSON body to answer with. */
  readonly json: unknown;
  readonly status?: number;
}

/** The adapter: metadata + auth config + the import implementation. */
/** Per-adapter vocabulary seam; preserves legacy types for older readers. */
export type VocabMap = (doc: NormalisedDoc, context?: { readonly webId?: string }) => NormalisedDoc;

/** Host-persisted state. Dates are ISO strings; counts describe the latest successful run. */
export interface ConnectorState {
  readonly connectedAt: string;
  readonly lastSync?: string;
  readonly cursor?: string;
  /** CLI file-import progress beside the API `cursor`, so neither path misreads the other. */
  readonly fileCursor?: string;
  readonly lastOutcome: "success" | "error";
  readonly counts: { readonly documents: number; readonly items: number; readonly skipped: number };
  /** Two-way health; details remain in the owner-only sync links and manifest. */
  readonly sync?: {
    readonly conflicts: number;
    readonly pendingDeletes: number;
    /** Items skipped this run with a fixed error class (retried or re-detected later). */
    readonly failed?: number;
    /** Imported items without a link; never created at the provider. */
    readonly unlinkedImports?: number;
    /** Items waiting on an unresolved create intent. */
    readonly deferred?: number;
  };
  /** Latest attempt, separate from the last successful checkpoint above. */
  readonly health?: ConnectorRunHealth;
  /** Independent cursors and health, keyed by a host-owned opaque account id. */
  readonly accounts?: Readonly<Record<string, ConnectorAccountState>>;
  /**
   * Root only: expiring cross-host run claims keyed by account id. A scheduler writes its
   * claim conditionally before fetching a token and removes it when the run ends; other
   * hosts skip that connection until `expiresAt`.
   */
  readonly claims?: Readonly<Record<string, ConnectorRunClaim>>;
}

export type ConnectorAccountState = Omit<ConnectorState, "accounts" | "claims">;

/** A cross-host run claim: a random per-run holder id and its expiry instant (ISO). */
export interface ConnectorRunClaim {
  readonly holder: string;
  readonly expiresAt: string;
}

export interface ConnectorRunCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

export type ConnectorErrorClass =
  | "deprecated"
  | "reauthorise"
  | "rate-limited"
  | "unauthorised"
  | "forbidden"
  | "conflict"
  | "source-or-pod"
  | "unexpected"
  | "aborted"
  /** The run exceeded the scheduler's run time limit. */
  | "timeout";

export interface ConnectorRunHealth {
  readonly lastRunStartedAt: string;
  readonly lastRunEndedAt: string;
  readonly outcome: "ok" | "partial" | "failed" | "needs-reauth";
  readonly counts: ConnectorRunCounts;
  readonly errorClass?: ConnectorErrorClass;
  /** Static adapter guidance for a deprecated connection. */
  readonly message?: string;
  readonly consecutiveFailures: number;
  readonly nextRunAt?: string;
  /**
   * For needs-reauth or deprecated: the connection row's `enabledAt` this latch was set against, or ""
   * when the row had none. The latch clears when the row's value differs (string compare).
   */
  readonly latchedEnabledAt?: string;
  /** The effective interval used for stale classification. */
  readonly intervalMinutes: number;
}

/** The vault lane supplies this port. Credentials must never enter persisted state. */
export interface TokenSource {
  /**
   * The run's signal aborts at shutdown or the run time limit; the scheduler stops waiting
   * then even if the vault ignores it. Throw ReauthoriseError for a missing or revoked
   * grant and NoVaultError when this host has no vault at all.
   */
  accessToken(connectorId: string, account: string, signal?: AbortSignal): Promise<string>;
  /**
   * Optional: discard a cached grant confirmed invalid — called only after two
   * consecutive source 401 (access token rejected) outcomes, never for 403s, rate limits
   * or other failures. Failures here never fail the run.
   *
   * It is called only for the grant that was in use for the rejected run, and never when
   * an owner re-enable superseded the latch (the row's `enabledAt` changed during the run,
   * in memory or in the stored settings) or the settings write failed or was cancelled.
   * The call can still race a reconnection, so implementations should discard only a
   * token matching that grant (e.g. the one they last returned from `accessToken`),
   * never a newer grant the owner has just supplied.
   */
  invalidate?(connection: {
    readonly connectorId: string;
    readonly account: string;
  }): Promise<void> | void;
}

/** A missing or revoked vault grant requires explicit owner re-enablement. */
export class ReauthoriseError extends Error {
  constructor() {
    super("Connector authorisation is required.");
    this.name = "ReauthoriseError";
  }
}

/**
 * This host has no token vault (a capability gap, not a revoked grant). The scheduler
 * skips the run without recording health, latching needs-reauth or changing settings.
 */
export class NoVaultError extends Error {
  constructor() {
    super("No token vault on this host.");
    this.name = "NoVaultError";
  }
}

/** The host settings row disappeared while a run was in flight; callers skip quietly. */
export class ConnectionRemovedError extends Error {
  constructor() {
    super("Connector connection was removed.");
    this.name = "ConnectionRemovedError";
  }
}

export interface ConnectorStateOptions {
  readonly state?: ConnectorState;
  /** Reports confirmed success or the previous state on failure. After-write privacy refusals report no state. */
  readonly onState?: (state: ConnectorState) => void;
  /** Bounded document accounting, also emitted after partial writes. */
  readonly onRunCounts?: (counts: ConnectorRunCounts) => void;
  /** Opt into document change comparisons; a counts listener also enables them. */
  readonly trackChanges?: boolean;
}

export interface IntegrationAdapter {
  /** Optional factory bounds, snapshotted and tightened by host run limits. */
  readonly limits?: Partial<RunLimits>;
  /** Optional bounded history for polling; older provenance links can outlive their summaries. */
  readonly maxRunActivities?: number;
  readonly vocabMap?: VocabMap;
  readonly metadata: IntegrationMetadata;
  /** Present iff `authKind === "oauth-pkce"`. */
  readonly oauth?: OAuthAppConfig;
  /** Optional provider-specific session transport, selected by the Node CLI after login. */
  createSourceAuth?(config: OAuthAppConfig, token: TokenSet, sourceFetch: typeof fetch): SourceAuth;
  /** Static headers every live API call needs (e.g. Twitch `Client-Id`). */
  readonly apiHeaders?: Readonly<Record<string, string>>;
  /** Recorded API fixtures — power demo mode AND the contract tests. */
  fixtures(): readonly FixtureRoute[];
  /** Pull → normalise → `ctx.write(...)`. Pure with respect to `ctx`. */
  import(ctx: ImportContext): Promise<ImportOutcome>;
}

/** Conditional HTTP write semantics shared by PodWriter implementations. */
export type WriteConditions =
  | { readonly ifMatch?: string; readonly ifNoneMatch?: never }
  | { readonly ifMatch?: never; readonly ifNoneMatch: "*" };

/** Validators from the write response only. */
export interface PrivateWriteVersion {
  readonly etag?: string;
}

/** One class-to-container Type Index registration. */
export interface TypeRegistrationRequest {
  readonly forClass: string;
  readonly container: string;
}

/** Returns a rejection when a session has refused further mutations. Check at dispatch. */
export type MutationGuard = () => Promise<never> | undefined;

type PrivateDestinationVerifier = ((url: string) => Promise<boolean>) & {
  /** Verification that can create containers must check the guard before doing so. */
  readonly beforeWrite?: (url: string, guard: MutationGuard) => Promise<boolean>;
};

/** Host-owned storage port, bound to one connector's document container. */
export interface PodWriter {
  /** Importing user's WebID; required for financial subjects and Steam account holders. */
  readonly webId?: string;
  /** Resolve an adapter-relative slug within its container. */
  resolve(slug: string): string;
  /** Verify the exact destination and its containing policy. Required for sensitive imports. */
  verifyPrivateDestination?: PrivateDestinationVerifier;
  /** Confirm that the written resource and its containing policy are owner-only. */
  confirmPrivateWrite?(
    url: string,
    version: PrivateWriteVersion,
    observeEtag?: (etag: string) => void,
  ): Promise<boolean>;
  /** Remove a refused create and confirm absence, using only the supplied cleanup signal. */
  cleanupPrivateWrite?(
    slug: string,
    options: { etag: string; signal: AbortSignal },
  ): Promise<boolean>;
  /** Read existing RDF and its ETag; undefined only for a missing document. */
  read(
    slug: string,
  ): Promise<{ dataset: DatasetCore; etag: string | null; lastModified?: string } | undefined>;
  /** Write RDF, preserving the caller's conditional-write precondition. */
  write(
    doc: NormalisedDoc,
    conditions?: WriteConditions,
    guard?: MutationGuard,
  ): Promise<WrittenDoc>;
  /** Notify the host after the runner accepts a payload write. */
  onWriteAccepted?(url: string, doc: NormalisedDoc): void;
  /**
   * Optional binary port with the same container confinement as `write`. `"create"` sends
   * `If-None-Match: *` and reports a 412 as an existing resource; `"replace"` reads the
   * current ETag first and sends `If-Match` (or `If-None-Match: *` when absent).
   */
  writeBinary?(doc: BinaryDoc, guard?: MutationGuard): Promise<WrittenBinary>;
  /** Optional delete port with the same confinement; 404 counts as already deleted. */
  remove?(
    slug: string,
    conditions?: { readonly ifMatch?: string },
    guard?: MutationGuard,
  ): Promise<void>;
  /** Ensure the distinct class/container registrations and report the index used. */
  registerType(
    registrations: readonly TypeRegistrationRequest[],
    guard?: MutationGuard,
  ): Promise<{ indexUrl: string }>;
}

/** Host-owned source API transport, already authenticated for this source. */
export interface SourceAuth {
  readonly fetch: typeof fetch;
  /** Scopes the token was granted, when the token response listed them (`ImportContext.scopes`). */
  readonly scopes?: readonly string[];
}
