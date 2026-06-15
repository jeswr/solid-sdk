/**
 * activity.ts — the typed ActivityStreams 2.0 (AS2.0) notification model + a
 * Turtle serialiser, built via TYPED `@rdfjs/wrapper` accessors and an n3 `Store`
 * (house rule: never hand-concat / hand-build RDF triples).
 *
 * The plain {@link ActivityNotification} shape is what callers build (no RDF
 * terms); {@link buildActivity} turns it into an n3 `Store`; {@link ActivityDoc}
 * is the typed view used both to write (send) and read (inbox parse).
 */
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/** AS2.0 activity verbs this package emits. (Reads accept any `as:*` type.) */
export type ActivityType = "Announce" | "Invite" | "Offer" | "Create" | "Update" | "Add" | "Remove";
/** The plain shape of a notification (no RDF terms) callers build / consume. */
export interface ActivityNotification {
    /** `as:type` — the activity verb (defaults to `Announce` on send). */
    type: ActivityType;
    /** `as:actor` — the sender's WebID. */
    actor: string;
    /** `as:object` — an IRI the activity is about (e.g. a chat container, a poll). */
    object?: string;
    /** `as:target` — an IRI the activity targets. */
    target?: string;
    /** `as:summary` — a short human-readable line. */
    summary?: string;
    /** `as:content` — a longer human-readable body. */
    content?: string;
    /** `as:published` — when it was sent (defaults to now on send). */
    published?: Date;
}
/** True for an absolute http(s) URL usable as an AS2.0 IRI object/actor/target. */
export declare function isHttpIri(value: string | undefined): boolean;
/** Typed `@rdfjs/wrapper` view of a single AS2.0 activity subject (read + write). */
export declare class ActivityDoc extends TermWrapper {
    get types(): Set<string>;
    setType(t: ActivityType): this;
    /** `as:actor` — sender WebID (object property). */
    get actor(): string | undefined;
    set actor(v: string | undefined);
    /**
     * `as:object` — an IRI the activity is about. Named `activityObject` (not
     * `object`) because `TermWrapper` already defines an `object` term getter.
     */
    get activityObject(): string | undefined;
    set activityObject(v: string | undefined);
    get target(): string | undefined;
    set target(v: string | undefined);
    get summary(): string | undefined;
    set summary(v: string | undefined);
    get content(): string | undefined;
    set content(v: string | undefined);
    get published(): Date | undefined;
    set published(v: Date | undefined);
}
/**
 * Build a fresh AS2.0 notification dataset rooted at the given subject (default
 * the relative `#it` — the inbox assigns the final IRI). Only http(s) IRIs are
 * written for actor/object/target (never coerce arbitrary text into a NamedNode).
 *
 * HOST-LEAK CARE: the payload carries only what the caller intended — the sender
 * WebID, optional object/target IRIs the caller explicitly supplies, a timestamp,
 * a type, and free-text summary/content. We never sweep in arbitrary internal pod
 * URLs, so a notification cannot exfiltrate private resource locations.
 */
export declare function buildActivity(notification: ActivityNotification, subject?: string): Store;
/** Serialise an n3 Store to Turtle with the `as:` prefix. */
export declare function serializeTurtle(store: Store): Promise<string>;
//# sourceMappingURL=activity.d.ts.map