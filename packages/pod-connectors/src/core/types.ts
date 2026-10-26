/**
 * The integration adapter contract (docs/integrations-catalog.md §"The common
 * adapter shape"). An adapter pulls a user's data from a platform API,
 * normalises it to RDF with standard vocabularies (via the typed wrappers in
 * `vocab.ts` — never inline quads), and writes it into the pod through the
 * import runner.
 */
import type { DatasetCore } from "@rdfjs/types";

/** Catalog tiers (docs/integrations-catalog.md). Only Tier A ships adapters. */
export type IntegrationTier = "A" | "B" | "C";

/** How the user connects. */
export type AuthKind =
  | "oauth-pkce" // end-user OAuth2 authorization-code + PKCE in a popup
  | "export-file" // Tier C: parse the platform's official data export
  | "none"; // metadata-only catalog entry (Tier B placeholder)

/** Static, render-ready description of an integration. No RDF, no I/O. */
export interface IntegrationMetadata {
  /** Stable catalog id; URL-safe (used in routes + container paths). */
  readonly id: string;
  readonly name: string;
  readonly tier: IntegrationTier;
  readonly authKind: AuthKind;
  /** OAuth scopes requested (empty for non-OAuth kinds). */
  readonly scopes: readonly string[];
  /** Category ids (`src/lib/categories.ts`) this integration writes into. */
  readonly categories: readonly string[];
  /** Plain-language "what you get" copy for the connect screen. */
  readonly whatYouGet: string;
  /** Honest go-live notes: what the maintainer must register/deploy. */
  readonly requirements: readonly string[];
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
  /** Extra query params some platforms require on the authorize URL. */
  readonly extraAuthParams?: Readonly<Record<string, string>>;
  /**
   * Send `Authorization: Basic base64(client_id + ":")` on the token request
   * (Reddit's installed-app convention for secretless clients).
   */
  readonly basicAuthForToken?: boolean;
}

/** Tokens. **In memory only** — never persisted, never sent anywhere except the platform. */
export interface TokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string;
  /** Epoch ms when the access token expires, when the platform said. */
  readonly expiresAt?: number;
}

/** One normalised document the adapter wants written into the pod. */
export interface NormalisedDoc {
  /**
   * Path under the adapter's root container, e.g. `"music/top-tracks.ttl"`.
   * Deterministic slugs ⇒ idempotent re-imports (overwrite, never duplicate).
   */
  readonly slug: string;
  /** Category id this document belongs to (for reporting + success copy). */
  readonly category: string;
  /** RDF class to register in the Type Index for the document's container. */
  readonly forClass: string;
  /** The document content, built via the typed vocab wrappers. */
  readonly dataset: DatasetCore;
  /**
   * Skip Type-Index registration for this doc's class (default false). Used
   * for companion documents that ride along in an already-registered
   * container (e.g. a profile doc beside the repositories collection).
   */
  readonly skipRegistration?: boolean;
}

/** A doc the runner wrote, with its final URL. */
export interface WrittenDoc {
  readonly url: string;
  readonly category: string;
  readonly forClass: string;
  readonly skipRegistration?: boolean;
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
   */
  read(slug: string): Promise<DatasetCore | undefined>;
  /** Write RDF; defaults to the precondition retained by a preceding read of this URL. */
  write(doc: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc>;
  /** Report progress to the UI. */
  progress(p: ImportProgress): void;
  /** Incremental cursor from the previous import of this adapter, if any. */
  readonly cursor?: string;
}

/** What `import()` returns (documents are reported by the runner). */
export interface ImportOutcome {
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
}

/** One recorded fixture route for the typed fake fetch. */
export interface FixtureRoute {
  /** HTTP method (default GET). */
  readonly method?: string;
  /** Exact URL or prefix the request URL must start with. */
  readonly url: string;
  /** JSON body to answer with. */
  readonly json: unknown;
  readonly status?: number;
}

/** The adapter: metadata + auth config + the import implementation. */
export interface IntegrationAdapter {
  readonly metadata: IntegrationMetadata;
  /** Present iff `authKind === "oauth-pkce"`. */
  readonly oauth?: OAuthAppConfig;
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

/** One class-to-container Type Index registration. */
export interface TypeRegistrationRequest {
  readonly forClass: string;
  readonly container: string;
}

/** Host-owned storage port, bound to one connector's document container. */
export interface PodWriter {
  /** Resolve an adapter-relative slug within its container. */
  resolve(slug: string): string;
  /** Read existing RDF and its ETag; undefined only for a missing document. */
  read(slug: string): Promise<{ dataset: DatasetCore; etag: string | null } | undefined>;
  /** Write RDF, preserving the caller's conditional-write precondition. */
  write(doc: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc>;
  /** Ensure the distinct class/container registrations and report the index used. */
  registerType(registrations: readonly TypeRegistrationRequest[]): Promise<{ indexUrl: string }>;
}

/** Host-owned source API transport, already authenticated for this source. */
export interface SourceAuth {
  readonly fetch: typeof fetch;
}
