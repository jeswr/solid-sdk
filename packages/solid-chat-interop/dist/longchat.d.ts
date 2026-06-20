/**
 * SolidOS `meeting:LongChat` ↔ canonical — the installed-base READ shape.
 *
 * A LongChat message is a `sioc:Note` carrying `sioc:content` (body),
 * `foaf:maker` (author WebID) and `dct:created` (timestamp); a reply is
 * `sioc:has_reply` / `as:inReplyTo`; an edit is `dct:isReplacedBy`; a delete is a
 * `schema:dateDeleted` tombstone. This mirrors the SolidOS chat pane and the Pod
 * Manager's longChat-reader (#95). On WRITE we stamp BOTH `sioc:Note` AND
 * `as:Note` (and `schema:Message`) — exactly as PM's `chat.ts` does — so the
 * message is recognisable to AS2.0-only readers too.
 *
 * The `wf:Task` actionable overlay carries through on the SAME subject (the shared
 * `@jeswr/solid-task-model` shape), so an actionable LongChat message federates as
 * a task with no chat-specific code.
 *
 * Typed `@rdfjs/wrapper` accessors only — never hand-built quads (house rule).
 * Every IRI-valued object is filtered http(s)-only on READ AND WRITE — a
 * non-http(s) value is DROPPED, never coerced.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import type { CanonicalMessage } from "./canonical.js";
/** Typed `@rdfjs/wrapper` view of a single SolidOS LongChat message subject. */
export declare class LongChatMessageDoc extends TermWrapper {
    get types(): Set<string>;
    /**
     * Stamp the subject as a LongChat message: `sioc:Note` (the SolidOS read shape)
     * PLUS `as:Note` and `schema:Message` (so AS2.0-only / schema.org readers see
     * it too) — exactly how PM's `chat.ts` marks a message.
     */
    mark(): this;
    get content(): string | undefined;
    set content(v: string | undefined);
    get author(): string | undefined;
    set author(v: string | undefined);
    get created(): Date | undefined;
    set created(v: Date | undefined);
    /**
     * The reply target. SolidOS/sioc uses `sioc:has_reply`; AS2.0 uses
     * `as:inReplyTo`. The getter prefers `as:inReplyTo` (the canonical form) and
     * falls back to `sioc:has_reply`; the setter writes BOTH so either reader finds
     * it. Both are filtered http(s)-only by the reconciler.
     */
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
/** The conventional LongChat message subject IRI for a resource (`<resource>#it`). */
export declare function longChatMessageSubject(resourceUrl: string): string;
/**
 * Parse a SolidOS LongChat message subject into a {@link CanonicalMessage}, or
 * `undefined` if the subject is not a `sioc:Note` (nor an `as:Note`, since a
 * suite-written message stamps both — accept either as the message marker).
 *
 * Every IRI-valued object is filtered http(s)-only on read (untrusted input).
 *
 * @param subject - the message subject IRI (e.g. {@link longChatMessageSubject}).
 */
export declare function parseLongChatMessage(subject: string, dataset: DatasetCore): CanonicalMessage | undefined;
/**
 * Build a fresh n3 `Store` holding one SolidOS LongChat message rooted at
 * `subject`, stamped `sioc:Note` + `as:Note` + `schema:Message`. When `msg.task`
 * is supplied the SAME subject is ALSO typed `wf:Task` with its lifecycle-state
 * class, `dct:title` and `wf:assignee` (the shared overlay).
 *
 * The canonical `room` and `mediaType` are NOT written: SolidOS LongChat models
 * the room by the message's CONTAINER (the `chat.ttl` it lives in), not an
 * `as:context` triple, and carries no per-message media type. They are preserved
 * across an AS2.0 round-trip but are not part of the LongChat wire shape.
 *
 * Every IRI-valued object is filtered http(s)-only on write. `created` defaults to
 * `now` when omitted.
 */
export declare function buildLongChatMessage(subject: string, msg: CanonicalMessage): Store;
//# sourceMappingURL=longchat.d.ts.map