// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `LibreChatAdapter` — ONE concrete {@link ChatAdapter} as proof of the seam.
 *
 * LibreChat (~28k★) stores conversations in MongoDB with NO storage SPI, so the
 * naive path dumps opaque, LibreChat-private, non-RDF documents into a pod. This
 * adapter instead maps LibreChat's public message shape onto the canonical model
 * per the solid-oss-integration-targets report (§3 LibreChat field map):
 *
 *   text            → content
 *   createdAt       → published
 *   conversationId  → room (under an optional `roomBaseIri`)
 *   parentMessageId → inReplyTo (under an optional `roomBaseIri`)
 *   sender / user   → (HUMAN) author = the configured human WebID
 *   model / endpoint → (AI) provenance.generatedBy + provenance.attributedTo = the
 *                       configured agent WebID
 *
 * **Human vs AI.** A user message (`isCreatedByUser === true`, or
 * `sender`/`role` naming the user) maps its author to the configured `humanWebId`
 * and carries NO provenance. An assistant/model message maps to honest PROV-O
 * attribution — `provenance.attributedTo` the agent WebID + `provenance.generatedBy`
 * the model/endpoint IRI — and carries NO `author` (it is not a human). This is the
 * "AI history lands as the SAME shape, with honest attribution" rule.
 *
 * **No fabricated IRIs.** WebIDs/agent IRIs are supplied by the caller via
 * {@link LibreChatAdapterOptions}; when none is configured the field is OMITTED
 * rather than invented. Everything that becomes an IRI is filtered http(s)-only.
 *
 * **No private fields leak.** Only the canonical fields above are read; LibreChat
 * internals (`_id`, `__v`, `tokenCount`, `error`, `unfinished`, `files`,
 * `finish_reason`, raw endpoint internals, …) are never copied into the canonical
 * model.
 */

import type { ChatAdapter } from "./adapter.js";
import type { CanonicalMessage, MessageProvenance } from "./canonical.js";
import { httpIriOrUndefined, safeHttpIri } from "./iri.js";

/**
 * The PUBLIC subset of a LibreChat message this adapter reads — the documented
 * export shape. Anything not listed here (LibreChat internals) is intentionally
 * absent: even if present on a runtime object, it is never copied into the
 * canonical model.
 */
export interface LibreChatMessage {
  /** The message body — `text`. */
  text?: string;
  /** Creation timestamp — `createdAt` (ISO-8601 string or epoch ms). */
  createdAt?: string | number;
  /** The conversation this message belongs to — `conversationId`. */
  conversationId?: string;
  /** The message this one replies to — `parentMessageId`. */
  parentMessageId?: string;
  /**
   * Whether the user (a human) authored this message. The PRIMARY human/AI
   * discriminator — `true` ⇒ human, `false` ⇒ assistant/model.
   */
  isCreatedByUser?: boolean;
  /**
   * The sender label — e.g. `"User"` for a human, or a model/assistant name.
   * A SECONDARY discriminator used only when `isCreatedByUser` is absent.
   */
  sender?: string;
  /** Chat role — `"user"` (human) or `"assistant"`/`"system"` (AI). Tertiary discriminator. */
  role?: string;
  /** The model that generated an AI message — `model`. */
  model?: string;
  /** The endpoint/provider that generated an AI message — `endpoint`. */
  endpoint?: string;
}

/** Configuration for {@link LibreChatAdapter} — supplies the IRIs LibreChat lacks. */
export interface LibreChatAdapterOptions {
  /**
   * The WebID to attribute HUMAN messages to (`author`). If omitted, a human
   * message's `author` is OMITTED rather than fabricated.
   */
  humanWebId?: string;
  /**
   * The agent WebID to attribute AI messages to (`provenance.attributedTo`). If
   * omitted, an AI message carries `provenance.generatedBy` (the model) only.
   */
  agentWebId?: string;
  /**
   * Base IRI under which `conversationId` → `room` and `parentMessageId` →
   * `inReplyTo` are resolved (e.g. `https://alice.example/chat/librechat/`). If
   * omitted, those id-shaped values are only used when they are ALREADY absolute
   * http(s) IRIs; otherwise they are dropped (never coerced into a NamedNode).
   */
  roomBaseIri?: string;
  /**
   * Resolves a LibreChat `model`/`endpoint` to an IRI for
   * `provenance.generatedBy`. If omitted, a default resolver mints a stable
   * `urn:librechat:model:<model>` URN, which is intentionally NOT an http(s) IRI
   * (so it is dropped by the IRI guard on write) — supply this to surface the model
   * as a real dereferenceable IRI.
   */
  resolveModelIri?: (model: string | undefined, endpoint: string | undefined) => string | undefined;
}

/** Default model→IRI resolver: a stable non-http URN (dropped by the IRI guard on write). */
function defaultResolveModelIri(
  model: string | undefined,
  endpoint: string | undefined,
): string | undefined {
  const m = (model ?? "").trim();
  const e = (endpoint ?? "").trim();
  if (!m && !e) return undefined;
  const label = [e, m].filter(Boolean).join(":");
  return `urn:librechat:model:${encodeURIComponent(label)}`;
}

/** Normalise a LibreChat `createdAt` (ISO string or epoch ms) to an ISO-8601 string. */
function toIso(createdAt: string | number | undefined): string | undefined {
  if (createdAt === undefined || createdAt === null) return undefined;
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Resolve a LibreChat id-shaped value (`conversationId` / `parentMessageId`) to an
 * absolute http(s) IRI, or `undefined`. An already-absolute http(s) value is used
 * as-is; otherwise it is resolved against `roomBaseIri` (when configured) and the
 * RESULT must itself be http(s). Anything else is dropped (never coerced).
 */
function resolveId(value: string | undefined, baseIri: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  // An already-absolute http(s) id is used as-is — but injection-safe-ESCAPED
  // (never the raw value), so an id like `http://e/a>b` cannot carry an IRI-injection
  // character into the canonical model and thence into `n3.Writer`. (The base-relative
  // branch below does the URL canonicalisation explicitly via `new URL`, not here.)
  const direct = safeHttpIri(v);
  if (direct !== undefined) return direct;
  if (!baseIri) return undefined;
  try {
    const resolved = new URL(encodeURIComponent(v), baseIri).toString();
    return httpIriOrUndefined(resolved);
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a LibreChat message is human-authored. Prefers the explicit
 * `isCreatedByUser` flag; falls back to `sender === "User"` / `role === "user"`.
 * Defaults to AI (false) when nothing indicates a human — the safe default for
 * attribution (never silently claim a human authored an unlabelled message).
 */
function isHuman(m: LibreChatMessage): boolean {
  if (typeof m.isCreatedByUser === "boolean") return m.isCreatedByUser;
  if (typeof m.sender === "string" && m.sender.trim().toLowerCase() === "user") return true;
  if (typeof m.role === "string" && m.role.trim().toLowerCase() === "user") return true;
  return false;
}

/**
 * The LibreChat → canonical adapter. Construct with the IRIs LibreChat lacks
 * ({@link LibreChatAdapterOptions}); call {@link toCanonical} per message.
 */
export class LibreChatAdapter implements ChatAdapter<LibreChatMessage> {
  private readonly opts: LibreChatAdapterOptions;
  private readonly resolveModelIri: NonNullable<LibreChatAdapterOptions["resolveModelIri"]>;

  constructor(opts: LibreChatAdapterOptions = {}) {
    this.opts = opts;
    this.resolveModelIri = opts.resolveModelIri ?? defaultResolveModelIri;
  }

  /**
   * Map one LibreChat message onto the canonical model. Reads ONLY the public
   * fields in {@link LibreChatMessage}; LibreChat internals never reach the result.
   */
  toCanonical(externalMessage: LibreChatMessage): CanonicalMessage {
    const m = externalMessage;
    const msg: CanonicalMessage = {
      content: typeof m.text === "string" ? m.text : "",
      mediaType: "text/plain",
    };

    const published = toIso(m.createdAt);
    if (published !== undefined) msg.published = published;

    const room = resolveId(m.conversationId, this.opts.roomBaseIri);
    if (room !== undefined) msg.room = room;

    const inReplyTo = resolveId(m.parentMessageId, this.opts.roomBaseIri);
    if (inReplyTo !== undefined) msg.inReplyTo = inReplyTo;

    if (isHuman(m)) {
      // Human message: attribute to the configured human WebID (omit if none —
      // never fabricate). No provenance.
      const author = httpIriOrUndefined(this.opts.humanWebId);
      if (author !== undefined) msg.author = author;
    } else {
      // AI/assistant message: honest PROV-O attribution, NO human author.
      const provenance: MessageProvenance = {};
      const attributedTo = httpIriOrUndefined(this.opts.agentWebId);
      if (attributedTo !== undefined) provenance.attributedTo = attributedTo;
      const generatedBy = httpIriOrUndefined(this.resolveModelIri(m.model, m.endpoint));
      if (generatedBy !== undefined) provenance.generatedBy = generatedBy;
      if (
        provenance.attributedTo !== undefined ||
        provenance.generatedBy !== undefined ||
        provenance.derivedFrom !== undefined
      ) {
        msg.provenance = provenance;
      }
    }

    return msg;
  }
}
