import { type Membership, type MembershipStatusName, type RegistryIssue } from "@jeswr/federation-registry";
import { type GuardOptions } from "./ssrf.js";
/**
 * Options for {@link discoverFromRegistry} / {@link resolveStorageSpecVersion}. The
 * `fetch` seam matches {@link import("./list.js").ListOptions} / {@link
 * import("./verify.js").VerifyOptions}; the remaining fields tune the SSRF guard.
 */
export interface RegistryOptions {
    /**
     * A `fetch` implementation (e.g. an authenticated Solid fetch). It is COMPOSED
     * UNDER the SSRF guard — the guard validates the URL + redirects and caps the
     * body, then issues the actual request through this fetch. Defaults to
     * `globalThis.fetch`.
     */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * SSRF-guard tuning (body cap, timeout, redirect cap, dev `allowLoopback`, a test
     * `dnsLookup`). See {@link GuardOptions}. The guard's own `fetch` is taken from
     * {@link RegistryOptions.fetch}; passing `guard.fetch` here is ignored.
     */
    readonly guard?: Omit<GuardOptions, "fetch">;
}
/**
 * A single registry-asserted membership discovered by {@link discoverFromRegistry}.
 * Mirrors {@link import("./list.js").ListedRegistration}'s shape: `id` + `source` +
 * the parsed view + `valid` + `issues` — so a caller already iterating `list()`
 * results can iterate these the same way.
 */
export interface DiscoveredMember {
    /** The app this membership concerns — its `client_id` IRI (`fedreg:app`). */
    readonly id: string;
    /** The registry document the membership was read from. */
    readonly source: string;
    /** The parsed membership record (the registry's assertion). */
    readonly membership: Membership;
    /** The membership lifecycle status short name, or `undefined` if absent/unknown. */
    readonly status?: MembershipStatusName;
    /**
     * `true` iff the registry treats this status as a live membership (only `Active`).
     * A convenience over `status` so a caller can filter to currently-trusted members
     * without importing the registry's `TRUSTED_STATUS` set.
     */
    readonly trusted: boolean;
    /** `true` iff the membership record verified clean against the fedreg vocab. */
    readonly valid: boolean;
    /** Verification issues for this membership (empty iff `valid`). */
    readonly issues: readonly RegistryIssue[];
}
/**
 * The result of {@link discoverFromRegistry}: the discovered memberships plus the
 * document-level outcome. Unlike {@link import("./list.js").list}'s bare array, this
 * carries `valid` + `issues` so a caller can distinguish "registry says no members"
 * from "the registry document could not be fetched/parsed" (e.g. an SSRF-refused or
 * 404'd URL) — a silently-empty array would hide that, which is unsafe for a
 * membership decision. (`@jeswr/federation-registry`'s own `listMembers` drops these
 * document-level errors; we build on `parseRegistry`, which preserves them.)
 */
export interface RegistryDiscovery {
    /** One {@link DiscoveredMember} per membership record, in document order. */
    readonly members: readonly DiscoveredMember[];
    /** `true` iff a single `fedreg:Registry` was found AND every membership verified clean. */
    readonly valid: boolean;
    /** Document-level issues (fetch / parse / no-registry / multiple-registries). */
    readonly issues: readonly RegistryIssue[];
}
/**
 * Discover the **registry-asserted** memberships in a federation registry document.
 *
 * This is the consume-a-registry counterpart to {@link import("./list.js").list}:
 * `list` discovers SELF-asserted `fedapp:App` registrations (which an app cannot use
 * as a membership claim); `discoverFromRegistry` reads the REGISTRY's own
 * `fedreg:Membership` assertions, each carrying a lifecycle `status` and an
 * `assertedBy` authority. A caller still checks `assertedBy` against its own trust
 * anchors — the registry SDK verifies well-formedness, not the signature binding the
 * assertion to that authority (see @jeswr/federation-registry's caveat).
 *
 * @param registryUrl - URL of a `fedreg:Registry` document. Fetched through the SSRF
 *   guard.
 * @returns a {@link RegistryDiscovery}: the per-membership entries plus the
 *   document-level `valid`/`issues` (so a fetch/parse failure is observable, not a
 *   silently-empty list).
 */
export declare function discoverFromRegistry(registryUrl: string, options?: RegistryOptions): Promise<RegistryDiscovery>;
/**
 * A storage's advertised client-client spec-version acceptance, resolved by
 * {@link resolveStorageSpecVersion}. Carries the parsed {@link StorageDescription}
 * (when found) plus its verification, and convenience predicates over the
 * spec-version set so a caller need not re-import the registry helpers.
 */
export interface ResolvedStorageSpec {
    /** The storage description IRI / source document. */
    readonly id: string;
    /** The storage the description is about (`fedreg:storage`; defaults to `id`). */
    readonly storage?: string;
    /** Client-client spec-VERSION IRIs the storage accepts (exact-IRI semantics). */
    readonly acceptsSpec: readonly string[];
    /** Data sector IRIs the storage supports. */
    readonly supportsSector: readonly string[];
    /** `true` iff a well-formed `fedreg:StorageDescription` was found. */
    readonly valid: boolean;
    /** Verification issues (empty iff `valid`). */
    readonly issues: readonly RegistryIssue[];
    /**
     * Does the storage accept `specVersionIri`? Exact-IRI match (spec versions are
     * immutable persistent IRIs — never a prefix/loose match). During a dual-read
     * window a storage advertises both old + new, so this is `true` for either.
     */
    accepts(specVersionIri: string): boolean;
    /**
     * The subset of `wanted` spec-versions this storage does NOT accept — the gap an
     * app must close (or wait for the storage to migrate) before writing all of them.
     * Empty ⇒ every wanted version is accepted.
     */
    unsupported(wanted: readonly string[]): string[];
}
/**
 * Resolve a storage's advertised client-client spec-version acceptance — the
 * schema-migration-coordination query. Before writing data validated against a spec
 * version, an app asks a storage's `fedreg:StorageDescription` whether it accepts
 * that version, so the app and the storage can migrate on independent clocks.
 *
 * @param storageUrl - URL of a `fedreg:StorageDescription` document (typically the
 *   storage root). Fetched through the SSRF guard.
 * @returns a {@link ResolvedStorageSpec} with the advertised versions + sectors and
 *   `accepts` / `unsupported` predicates. **Fail-closed on the whole verification:**
 *   unless the description verified clean (`valid === true`) the version/sector lists
 *   are empty and `accepts` returns `false` for every version — an app must never
 *   write against an unverifiable (absent, partial, or malformed) storage description.
 */
export declare function resolveStorageSpecVersion(storageUrl: string, options?: RegistryOptions): Promise<ResolvedStorageSpec>;
export type { Membership, MembershipStatusName, RegistryIssue, StorageDescription, } from "@jeswr/federation-registry";
//# sourceMappingURL=registry.d.ts.map