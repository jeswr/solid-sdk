/**
 * ActivityStreams 2.0 ↔ canonical — the suite's CANONICAL chat shape.
 *
 * A message is an `as:Note` (mirroring `@jeswr/pod-chat`'s `message.ts` exactly):
 * `as:content` / `as:mediaType` / `as:attributedTo` / `as:published` /
 * `as:context` / `as:inReplyTo`, with the actionable `wf:Task` overlay layered on
 * the SAME subject (via `@jeswr/solid-task-model`'s class + state consts). This
 * package additionally carries PROV-O provenance (AI/external attribution), the
 * `dct:isReplacedBy` edit pointer and the `schema:dateDeleted` tombstone so AS2.0
 * can round-trip the full canonical model.
 *
 * Everything goes through typed `@rdfjs/wrapper` accessors — never hand-built
 * quads (house rule). Every IRI-valued object (author / room / inReplyTo /
 * replacedBy / the provenance members / the task assignee) is filtered http(s)-only
 * via {@link isHttpIri} on READ AND WRITE — a non-http(s) value is DROPPED, never
 * coerced into a malformed `NamedNode`.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import type { CanonicalMessage } from "./canonical.js";
/** Typed `@rdfjs/wrapper` view of a single AS2.0 message subject (`as:Note`). */
export declare class As2MessageDoc extends TermWrapper {
    get types(): Set<string>;
    /** Stamp the subject as an `as:Note`. */
    markNote(): this;
    get content(): string | undefined;
    set content(v: string | undefined);
    get mediaType(): string | undefined;
    set mediaType(v: string | undefined);
    get author(): string | undefined;
    set author(v: string | undefined);
    get published(): Date | undefined;
    set published(v: Date | undefined);
    get room(): string | undefined;
    set room(v: string | undefined);
    get inReplyTo(): string | undefined;
    set inReplyTo(v: string | undefined);
    get replacedBy(): string | undefined;
    set replacedBy(v: string | undefined);
    get deletedAt(): Date | undefined;
    set deletedAt(v: Date | undefined);
    get provAttributedTo(): string | undefined;
    set provAttributedTo(v: string | undefined);
    get provGeneratedBy(): string | undefined;
    set provGeneratedBy(v: string | undefined);
    get provDerivedFrom(): string | undefined;
    set provDerivedFrom(v: string | undefined);
    get taskTitle(): string | undefined;
    set taskTitle(v: string | undefined);
    get assignee(): string | undefined;
    set assignee(v: string | undefined);
}
/** The conventional AS2.0 message subject IRI for a resource (`<resource>#it`). */
export declare function as2MessageSubject(resourceUrl: string): string;
/**
 * Parse an AS2.0 message subject out of a dataset into a {@link CanonicalMessage},
 * or `undefined` if the subject is not an `as:Note`.
 *
 * Every IRI-valued object is filtered http(s)-only on read (a foreign document is
 * untrusted input): a non-http(s) author/room/inReplyTo/replacedBy/provenance/
 * assignee is dropped, never surfaced.
 *
 * @param subject - the message subject IRI (e.g. {@link as2MessageSubject}).
 */
export declare function parseAs2Message(subject: string, dataset: DatasetCore): CanonicalMessage | undefined;
/**
 * Build a fresh n3 `Store` holding one AS2.0 message rooted at `subject`, typed
 * `as:Note` — and, when `msg.task` is supplied, ALSO typed `wf:Task` with its
 * lifecycle-state class, `dct:title` and `wf:assignee` (the shared overlay).
 *
 * Every IRI-valued object is filtered http(s)-only on write: a non-http(s)
 * author/room/inReplyTo/replacedBy/provenance/assignee is dropped rather than
 * coerced into a malformed `NamedNode` (keeping the graph well-formed). `published`
 * defaults to `now` when omitted.
 */
export declare function buildAs2Message(subject: string, msg: CanonicalMessage): Store;
export { isHttpIri } from "./iri.js";
//# sourceMappingURL=as2.d.ts.map