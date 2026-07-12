import type { AppRegistration, VerificationIssue } from "./types.js";
/** A single entry returned by {@link list}. */
export interface ListedRegistration {
    /** The app's IRI (its `fedapp:App` subject / client_id). */
    readonly id: string;
    /** The document the registration was read from. */
    readonly source: string;
    /** The parsed registration. */
    readonly registration: AppRegistration;
    /** `true` iff the registration verified clean. */
    readonly valid: boolean;
    /** Verification issues for this registration (empty iff `valid`). */
    readonly issues: readonly VerificationIssue[];
}
/** Options for {@link list}. */
export interface ListOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * Treat `source` as an LDP container and fetch each `ldp:contains` member as a
     * separate registration document. When `false` (default), the source document
     * itself is parsed for inline `fedapp:App` subjects. When `"auto"`, members are
     * followed only if the source declares no inline `fedapp:App` subjects.
     */
    readonly followContainer?: boolean | "auto";
}
/**
 * List app registrations discoverable from a registry resource or container.
 *
 * @param source - URL of a registry resource or an app-registry container.
 * @returns one {@link ListedRegistration} per `fedapp:App` discovered.
 */
export declare function list(source: string, options?: ListOptions): Promise<ListedRegistration[]>;
//# sourceMappingURL=list.d.ts.map