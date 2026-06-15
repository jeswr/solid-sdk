// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * activity.ts — the typed ActivityStreams 2.0 (AS2.0) notification model + a
 * Turtle serialiser, built via TYPED `@rdfjs/wrapper` accessors and an n3 `Store`
 * (house rule: never hand-concat / hand-build RDF triples).
 *
 * The plain {@link ActivityNotification} shape is what callers build (no RDF
 * terms); {@link buildActivity} turns it into an n3 `Store`; {@link ActivityDoc}
 * is the typed view used both to write (send) and read (inbox parse).
 */
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { AS, RDF_TYPE } from "./config.js";
/** True for an absolute http(s) URL usable as an AS2.0 IRI object/actor/target. */
export function isHttpIri(value) {
    if (!value)
        return false;
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
/** Typed `@rdfjs/wrapper` view of a single AS2.0 activity subject (read + write). */
export class ActivityDoc extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    setType(t) {
        this.types.add(`${AS}${t}`);
        return this;
    }
    /** `as:actor` — sender WebID (object property). */
    get actor() {
        return OptionalFrom.subjectPredicate(this, `${AS}actor`, NamedNodeAs.string);
    }
    set actor(v) {
        OptionalAs.object(this, `${AS}actor`, v, NamedNodeFrom.string);
    }
    /**
     * `as:object` — an IRI the activity is about. Named `activityObject` (not
     * `object`) because `TermWrapper` already defines an `object` term getter.
     */
    get activityObject() {
        return OptionalFrom.subjectPredicate(this, `${AS}object`, NamedNodeAs.string);
    }
    set activityObject(v) {
        OptionalAs.object(this, `${AS}object`, v, NamedNodeFrom.string);
    }
    get target() {
        return OptionalFrom.subjectPredicate(this, `${AS}target`, NamedNodeAs.string);
    }
    set target(v) {
        OptionalAs.object(this, `${AS}target`, v, NamedNodeFrom.string);
    }
    get summary() {
        return OptionalFrom.subjectPredicate(this, `${AS}summary`, LiteralAs.string);
    }
    set summary(v) {
        OptionalAs.object(this, `${AS}summary`, v, LiteralFrom.string);
    }
    get content() {
        return OptionalFrom.subjectPredicate(this, `${AS}content`, LiteralAs.string);
    }
    set content(v) {
        OptionalAs.object(this, `${AS}content`, v, LiteralFrom.string);
    }
    get published() {
        return OptionalFrom.subjectPredicate(this, `${AS}published`, LiteralAs.date);
    }
    set published(v) {
        OptionalAs.object(this, `${AS}published`, v, LiteralFrom.dateTime);
    }
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
export function buildActivity(notification, subject = "#it") {
    const store = new Store();
    const doc = new ActivityDoc(subject, store, DataFactory).setType(notification.type);
    doc.actor = isHttpIri(notification.actor) ? notification.actor : undefined;
    doc.activityObject = isHttpIri(notification.object)
        ? notification.object
        : undefined;
    doc.target = isHttpIri(notification.target) ? notification.target : undefined;
    doc.summary = notification.summary?.trim() || undefined;
    doc.content = notification.content?.trim() || undefined;
    doc.published = notification.published ?? new Date();
    return store;
}
/** Serialise an n3 Store to Turtle with the `as:` prefix. */
export function serializeTurtle(store) {
    return new Promise((resolve, reject) => {
        const writer = new Writer({ prefixes: { as: AS } });
        for (const quad of store)
            writer.addQuad(quad);
        writer.end((error, result) => {
            if (error)
                reject(error);
            else
                resolve(result);
        });
    });
}
//# sourceMappingURL=activity.js.map