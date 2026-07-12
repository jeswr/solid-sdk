/**
 * `importCalendar` / `importAddressBook` — read CalDAV iCalendar VEVENTs / CardDAV
 * vCards and write them into a Solid pod as owner-private RDF resources.
 *
 * The flow mirrors the suite's granary-ingest pattern:
 *   DAV text (`icsText` / `vcfText`, OR a `davUrl` routed through the SSRF guard)
 *     → parse components (`ical.ts`)
 *     → {@link veventToEvent} / {@link vcardToContact} (pure mappers, map.ts)
 *     → serialise (n3.Writer for events; `@jeswr/solid-task-model`'s buildPerson +
 *       storeToTurtle for contacts — never hand-built triples)
 *     → PUT under the caller's container via an injectable authed `writeFetch`.
 *
 * OWNER-PRIVACY CONTRACT (load-bearing — see SECURITY in the README). Imported
 * third-party data lands in the user's pod and MUST default to owner-only; this
 * module NEVER writes an ACL/ACR that broadens access and never auto-shares. The
 * effective access of each written resource is whatever the TARGET CONTAINER's ACL
 * grants — so the caller MUST pass a container that is already owner-private (a
 * freshly-provisioned private container inherits owner-only access). The module
 * fails CLOSED on a write error (it stops on the first failure unless
 * `continueOnError` is set) and returns a per-item report so the caller can audit
 * exactly what was written.
 *
 * The optional remote fetch-from-DAV helper lives in `remote.ts` and is the ONLY
 * place a user-configured URL is dereferenced — always through `@jeswr/guarded-fetch`
 * (SSRF-safe). When a caller passes `icsText` / `vcfText` directly, NO network is
 * touched (the unit-testable path).
 */
import { type MappedContact, type MappedEvent } from "./map.js";
import { type DavAuth } from "./remote.js";
/** Conditional-write modes for a PUT. */
export type Conditional = "if-none-match" | "overwrite" | "none";
/** The outcome of writing one imported item. */
export interface ImportItemResult {
    /** Zero-based index of the item within the source. */
    readonly index: number;
    /** The full resource URL written (or attempted). */
    readonly url: string;
    /** `true` if the PUT returned a 2xx status. */
    readonly written: boolean;
    /** The HTTP status, when a response was received. */
    readonly status?: number;
    /** A short error message when the write failed (NEVER contains a credential). */
    readonly error?: string;
}
/** The aggregate report returned by an import. */
export interface ImportResult {
    /** How many items were extracted from the source. */
    readonly total: number;
    /** How many were written successfully (2xx). */
    readonly written: number;
    /** How many failed. */
    readonly failed: number;
    /** Per-item outcome, in source order. */
    readonly items: ImportItemResult[];
}
/** Shared options for both importers ({@link importCalendar} / {@link importAddressBook}). */
export interface BaseImportOptions {
    /**
     * The authed `fetch` used to PUT each resource. Injectable so the import is
     * unit-testable with a stubbed fetch (no live server) and so the caller wires in
     * its own DPoP/WebID-authenticated fetch. Defaults to `globalThis.fetch` (almost
     * never what a real caller wants — pass an authed one).
     */
    readonly writeFetch?: typeof globalThis.fetch;
    /**
     * The container URL each resource is written under (MUST end with `/`). The
     * container MUST already be owner-private — written resources inherit its ACL;
     * this module never broadens access (the owner-privacy contract).
     */
    readonly container: string;
    /**
     * The DAV endpoint URL to read from (alternative to passing the text directly).
     * Dereferenced ONLY through `@jeswr/guarded-fetch` (SSRF-safe). https-only.
     */
    readonly davUrl?: string;
    /** Optional DAV auth credential for `davUrl` (NEVER logged / URL-embedded). */
    readonly davAuth?: DavAuth;
    /** An SSRF-safe fetch override for the DAV read (defaults to nodeGuardedFetch). */
    readonly davFetch?: typeof globalThis.fetch;
    /** Cap on the number of items imported (default unbounded). */
    readonly maxItems?: number;
    /**
     * When `true`, a per-item write failure is recorded and the import CONTINUES;
     * when `false` (the default — fail-closed) the import stops on the first write
     * error and rethrows it after recording the partial report.
     */
    readonly continueOnError?: boolean;
    /**
     * Conditional-write header for each PUT — `"if-none-match"` writes with
     * `If-None-Match: *` (create-only), `"overwrite"` writes unconditionally (honour
     * source edits on re-sync), `"none"` adds no conditional header. Default
     * `"overwrite"`.
     */
    readonly conditional?: Conditional;
}
/** Options for {@link importCalendar}. */
export interface ImportCalendarOptions extends BaseImportOptions {
    /** Already-fetched iCalendar text (the unit-testable path; no network). */
    readonly icsText?: string;
    /** Mint the resource slug for an event. Defaults to a stable UID-derived slug. */
    readonly slug?: (event: MappedEvent, index: number) => string;
}
/** Options for {@link importAddressBook}. */
export interface ImportAddressBookOptions extends BaseImportOptions {
    /** Already-fetched vCard text (the unit-testable path; no network). */
    readonly vcfText?: string;
    /** `vcard:inAddressBook` — the owning address book IRI written on each person. */
    readonly inAddressBook?: string;
    /** Mint the resource slug for a contact. Defaults to a stable UID-derived slug. */
    readonly slug?: (contact: MappedContact, index: number) => string;
}
/**
 * A stable, filesystem-safe slug for an event, derived from its `UID` (so a
 * re-sync of the SAME source event targets the SAME resource — idempotent + honours
 * edits), else its subject, hashed to a short token.
 */
export declare function defaultEventSlug(event: MappedEvent, index: number): string;
/** A stable, filesystem-safe slug for a contact, derived from its `UID`. */
export declare function defaultContactSlug(contact: MappedContact, index: number): string;
/**
 * Import iCalendar VEVENTs into a Solid pod as `schema:Event` Turtle resources.
 *
 * Pass EITHER `icsText` (already-fetched, no network) OR `davUrl` (routed through
 * the SSRF guard). Each VEVENT becomes one owner-private resource under
 * `options.container`. Returns a per-item report.
 */
export declare function importCalendar(options: ImportCalendarOptions): Promise<ImportResult>;
/**
 * Import vCards into a Solid pod as SolidOS-readable `vcard:Individual` Turtle
 * resources (via `@jeswr/solid-task-model`'s `buildPerson` — never hand-built
 * triples).
 *
 * Pass EITHER `vcfText` (already-fetched, no network) OR `davUrl` (routed through
 * the SSRF guard). Each vCard becomes one owner-private resource under
 * `options.container`. Returns a per-item report.
 */
export declare function importAddressBook(options: ImportAddressBookOptions): Promise<ImportResult>;
//# sourceMappingURL=ingest.d.ts.map