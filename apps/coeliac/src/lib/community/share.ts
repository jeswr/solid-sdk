// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The sanitised share-card GENERATOR (Phase 4B, design §4.1) — the
 * privacy-critical core. Pure functions that turn the user's OWN data into a
 * small, deliberately-constructed card the user explicitly chose to share, with
 * everything identifying/sensitive STRIPPED.
 *
 * Three load-bearing invariants, enforced fail-closed by {@link assertShareable}
 * (the single chokepoint every generator ends on):
 *  1. **No diary leak.** No `/health/diary/` IRI, ever, in any field or the body.
 *  2. **No provenance-derivation link.** A share carries NO `provenance.derivedFrom`
 *     — the user↔source link lives only in the owner-only sidecar (design §4.1).
 *  3. **No real-identity leak on a public card.** A public card's author must be
 *     origin-unlinkable from the real WebID, and its body must not contain it.
 *
 * Genetics + raw symptom detail cannot leak because the generators accept ONLY
 * sanitised primitives (user-picked food/venue/experience strings, tolerated
 * trigger slugs) — there is no code path from a `diet:GeneticSummary`,
 * `diet:Symptom`, or `diet:Exposure` into a card. `deriveSafeFoodCandidates`
 * demonstrates the sanitising extraction: a concluded `ToleranceConclusion` carries
 * `derivedFrom` (diary IRIs) + `patient` (the real WebID) + dates; the extractor
 * keeps ONLY the tolerated trigger slug and drops all of it.
 */
import { isTriggerSlug, type ToleranceConclusionData, type TriggerSlug } from "@jeswr/solid-health-diary";
import type { CommunityIdentity } from "./identity.js";
import { assertIdentityForAudience, authorForIdentity, httpHost, sharesHost } from "./identity.js";
import type { CanonicalMessage, ShareAudience, ShareCard, ShareKind } from "./share-card.js";
import { DEFAULT_MEDIA_TYPE, SHARE_CLASS } from "./share-card.js";
import { containsDiaryScope, safeDecodeAll } from "./share-layout.js";

/** Thrown when a card would leak diary/genetics/provenance or a real identity. */
export class ShareSanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareSanitizationError";
  }
}

/** Max length of a single sanitised line (food/venue name). */
const MAX_LINE = 200;
/** Max length of a sanitised free-text body (experience / venue note). */
const MAX_TEXT = 2000;
/** Max number of food items on a card (keeps the card small + reviewable). */
const MAX_FOODS = 50;

/**
 * Sanitise a single short line: trim, collapse internal whitespace, strip control
 * characters + newlines, cap length. Returns `""` for an all-blank input (dropped
 * by the caller).
 */
export function sanitizeLine(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LINE);
}

/** Sanitise a free-text body: strip control chars (keep newlines), trim, cap length. */
export function sanitizeText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * Extract the SAFE (tolerated) trigger slugs from concluded tolerance conclusions.
 * The SANITISING extractor: it keeps ONLY `aboutTrigger` where `verdict ===
 * "tolerated"`, deduped — and drops `derivedFrom` (diary IRIs), `patient` (the real
 * WebID), `note`, `confidence`, `reviewAfter`, `created`, and `id`. Pure.
 */
export function deriveSafeFoodCandidates(
  conclusions: readonly ToleranceConclusionData[],
): { tolerated: TriggerSlug[] } {
  const tolerated: TriggerSlug[] = [];
  for (const c of conclusions) {
    if (c.verdict === "tolerated" && isTriggerSlug(c.aboutTrigger) && !tolerated.includes(c.aboutTrigger)) {
      tolerated.push(c.aboutTrigger);
    }
  }
  return { tolerated };
}

/** Shared inputs for every generator. */
interface BaseShareInput {
  /** The pseudonymous identity to attribute the card to (design §4.2). */
  identity: CommunityIdentity;
  /** The destination audience (`owner-only` default). */
  audience: ShareAudience;
  /** The user's REAL WebID — used only to enforce the fail-closed guards. */
  realWebId: string;
  /** Publish timestamp; defaults to now. */
  published?: Date;
}

/** Input for a safe-foods card. */
export interface SafeFoodShareInput extends BaseShareInput {
  /** User-picked product names (the user chooses exactly what to include). */
  foods: string[];
  /** Optional tolerated trigger slugs (sanitised labels only — no evidence). */
  toleratedTriggers?: TriggerSlug[];
}

/** Input for a safe-venue card. */
export interface SafeVenueShareInput extends BaseShareInput {
  /** The venue name the user picked. */
  venue: string;
  /** An optional short note. */
  note?: string;
}

/** Input for a free-text experience card. */
export interface ExperienceShareInput extends BaseShareInput {
  /** The user-authored experience text (nothing is auto-included). */
  text: string;
}

/** Build the `CanonicalMessage` shell for a card (author per audience, no provenance). */
function buildMessage(
  content: string,
  input: BaseShareInput,
): CanonicalMessage {
  const author = authorForIdentity(input.identity);
  const msg: CanonicalMessage = {
    content,
    mediaType: DEFAULT_MEDIA_TYPE,
    published: (input.published ?? new Date()).toISOString(),
  };
  // Only attach an author when the identity supplies a WebID (public may omit it).
  if (author !== undefined) msg.author = author;
  return msg;
}

/**
 * Generate a sanitised **safe-foods** card (`diet:SafeFoodShare`). Fails closed on
 * an unsafe identity/audience combination or any diary/identity leak.
 */
export function generateSafeFoodShare(input: SafeFoodShareInput): ShareCard {
  assertIdentityForAudience(input.identity, input.audience, input.realWebId);

  const foods = Array.from(
    new Set(input.foods.map(sanitizeLine).filter((f) => f.length > 0)),
  ).slice(0, MAX_FOODS);
  const triggers = Array.from(
    new Set((input.toleratedTriggers ?? []).filter(isTriggerSlug)),
  );

  if (foods.length === 0 && triggers.length === 0) {
    throw new ShareSanitizationError("a safe-foods card needs at least one food or tolerated trigger");
  }

  const parts: string[] = [];
  if (foods.length > 0) parts.push(`Safe foods that work for me: ${foods.join(", ")}.`);
  if (triggers.length > 0) parts.push(`Triggers I now tolerate: ${triggers.join(", ")}.`);
  const content = parts.join("\n");

  return finalize("safe-food", buildMessage(content, input), input);
}

/**
 * Generate a sanitised **safe-venue** card (`diet:SafeVenueShare`) — a venue the
 * user had no reaction at. No meal IRI, no date, no symptom linkage.
 */
export function generateSafeVenueShare(input: SafeVenueShareInput): ShareCard {
  assertIdentityForAudience(input.identity, input.audience, input.realWebId);

  const venue = sanitizeLine(input.venue);
  if (venue.length === 0) {
    throw new ShareSanitizationError("a safe-venue card needs a venue name");
  }
  const note = input.note ? sanitizeText(input.note) : "";
  const content = note
    ? `A gluten-free-friendly place I had no reaction at: ${venue}.\n${note}`
    : `A gluten-free-friendly place I had no reaction at: ${venue}.`;

  return finalize("safe-venue", buildMessage(content, input), input);
}

/**
 * Generate a sanitised **experience** card (`diet:ExperienceShare`) — user-authored
 * free text; nothing is auto-included.
 */
export function generateExperienceShare(input: ExperienceShareInput): ShareCard {
  assertIdentityForAudience(input.identity, input.audience, input.realWebId);

  const content = sanitizeText(input.text);
  if (content.length === 0) {
    throw new ShareSanitizationError("an experience card needs some text");
  }
  return finalize("experience", buildMessage(content, input), input);
}

/** Assemble the card and run the fail-closed sanitisation guard before returning. */
function finalize(kind: ShareKind, message: CanonicalMessage, input: BaseShareInput): ShareCard {
  const card: ShareCard = { kind, shareClass: SHARE_CLASS[kind], message, audience: input.audience };
  assertShareable(card, { realWebId: input.realWebId });
  return card;
}

/** Every IRI-valued field on a card's message (for the guard + tests). */
export function collectIris(card: ShareCard): string[] {
  const m = card.message;
  return [m.id, m.author, m.room, m.inReplyTo, m.replacedBy, m.deletedAt, m.provenance?.attributedTo, m.provenance?.generatedBy, m.provenance?.derivedFrom].filter(
    (v): v is string => typeof v === "string",
  );
}

/**
 * The fail-closed sanitisation guard (design §4.1/§4.2 — the load-bearing privacy
 * invariant). Throws {@link ShareSanitizationError} if a card could leak the diary,
 * a diary provenance IRI, or (for a public card) the real identity. Called at the
 * end of every generator AND again at publish time (defence in depth).
 */
export function assertShareable(card: ShareCard, ctx: { realWebId: string }): void {
  const { message } = card;

  // (0) A card body is ALWAYS plain text — never text/html or another type a reader
  // might render (stored-XSS guard, roborev Medium). Generators only ever set
  // text/plain; this refuses a hand-built card that does not.
  if (message.mediaType !== DEFAULT_MEDIA_TYPE) {
    throw new ShareSanitizationError(`a share card body must be ${DEFAULT_MEDIA_TYPE}, not ${message.mediaType}`);
  }

  // (2) A share NEVER carries a provenance-derivation link — that lives only in
  // the owner-only sidecar. Fail-closed even before the diary-IRI check.
  if (message.provenance?.derivedFrom !== undefined) {
    throw new ShareSanitizationError(
      "a share card must not carry provenance.derivedFrom — the source link belongs only in the owner-only sidecar",
    );
  }

  // (1) No diary IRI in any field or the body, for ANY audience.
  for (const iri of collectIris(card)) {
    if (containsDiaryScope(iri)) {
      throw new ShareSanitizationError(`a share card field leaks a diary IRI: ${iri}`);
    }
  }
  if (containsDiaryScope(message.content)) {
    throw new ShareSanitizationError("a share card body leaks a diary IRI");
  }

  // (3) A public card must not leak the real identity. EVERY IRI-valued field —
  // author, room, inReplyTo, replacedBy, provenance — must be unlinkable, not just
  // the author (roborev Medium): any field on the real pod host is linkable. A
  // non-http(s) IRI shares no host and is dropped at serialisation, so it is safe.
  if (card.audience === "public") {
    for (const iri of collectIris(card)) {
      if (iri === ctx.realWebId || sharesHost(iri, ctx.realWebId)) {
        throw new ShareSanitizationError(
          "a public share card field is linkable to your real WebID (same host or equal) — refused",
        );
      }
    }
    // The body must not name the real WebID OR the real pod HOST in any form — a
    // bare host ("alice.example") or a same-host URL links the card back just as a
    // full WebID does (roborev High). Case-INSENSITIVE (hosts are case-insensitive,
    // so "ALICE.EXAMPLE" must not bypass — roborev High) and over the fail-safe
    // decoded body too. `httpHost` already lower-cases the host.
    const host = httpHost(ctx.realWebId);
    const hay = `${message.content}\n${safeDecodeAll(message.content)}`.toLowerCase();
    if (hay.includes(ctx.realWebId.toLowerCase())) {
      throw new ShareSanitizationError("a public share card body contains your real WebID — refused");
    }
    if (host !== null && hay.includes(host)) {
      throw new ShareSanitizationError("a public share card body contains your real pod host — refused");
    }
  }
}
