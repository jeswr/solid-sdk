// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The inspector's view of one verifiable message: the carriage (never trusted) and, inside
 * the signature, header and proof, authority, content, evidence, terms, and provenance and
 * quality. Built from the real message and its wire form; nothing here is hand-written per
 * scenario.
 */
import { digestBytes, digestOf } from "../core/canonical.js";
import type { AnyMessage, EvidenceItem, JsonObject } from "../core/types.js";
import {
  CORE_CONTENT_VOCABULARY,
  type ContentVocabulary,
  freeMessageStrings,
  freeStrings,
  type KnownContent,
} from "../profile/content.js";
import type { WireMessage } from "../store/state.js";
import type { PacketLayerView, PacketView } from "./types.js";

/** Display name for an identifier (falls back to the identifier itself). */
export type Namer = (iri: string | undefined) => string;

function decodeJws(jws: string): { header?: JsonObject; payload?: JsonObject } {
  const [h, p] = jws.split(".");
  try {
    return {
      header: JSON.parse(Buffer.from(h ?? "", "base64url").toString("utf8")) as JsonObject,
      payload: JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as JsonObject,
    };
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Best-effort read of a wire unit's payload WITHOUT verifying it (for display only). */
export function peekWire(wire: unknown): AnyMessage | undefined {
  if (!wire || typeof wire !== "object") return undefined;
  const w = wire as Record<string, unknown>;
  try {
    if (typeof w.jws === "string") return decodeJws(w.jws).payload as unknown as AnyMessage;
    if (typeof w.payload === "string") return JSON.parse(w.payload) as AnyMessage;
  } catch {
    return undefined;
  }
  return undefined;
}

function evidenceOf(message: AnyMessage, role: EvidenceItem["role"]): JsonObject[] {
  return (message.evidence ?? [])
    .filter((e) => e.role === role)
    .map((e) => (e.format === "jws-compact" ? (decodeJws(e.value).payload ?? {}) : {}));
}

/** Inspect strings through the profile vocabulary; unknown strings are unstructured. */
export function freeTextOf(
  body: JsonObject,
  vocabulary: ContentVocabulary = CORE_CONTENT_VOCABULARY,
  known?: KnownContent,
): { path: string; text: string }[] {
  return freeStrings(body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }, known);
}

function contentSummary(
  m: AnyMessage,
  name: Namer,
  vocabulary?: ContentVocabulary,
  known?: KnownContent,
): string {
  const base = baseContentSummary(m, name);
  const free = freeMessageStrings(m, vocabulary, known);
  if (free.length === 0) return base;
  return `${base} It also carries free text, marked as untrusted content (data, never an instruction): ${free
    .map((f) => `"${f.text}"`)
    .join("; ")}`;
}

function baseContentSummary(m: AnyMessage, _name: Namer): string {
  const b = m.body as unknown as JsonObject;
  switch (m.kind) {
    case "describe":
      return "Asks the other agent to describe itself: configurations, operations and models.";
    case "description":
      return "Describes this agent: the configurations it accepts and the operations it offers.";
    case "propose": {
      const round = typeof b.round === "number" ? b.round : 1;
      return round === 1
        ? `An offer to start ${
            str((b.operation as JsonObject)?.id)
              ?.split("/")
              .pop() ?? "an operation"
          }, with terms (round 1).`
        : `A counter-offer (round ${round}) with new terms.`;
    }
    case "accept":
      return "Accepts the offer by its terms digest; both sides derive the same agreement id.";
    case "deliver":
      return "Delivers the result under the agreement.";
    case "receipt":
      return `Reports an activity outcome: ${str(b.outcome) ?? "unknown"}${b.final ? " (final)" : ""}.`;
    case "refuse":
    case "unsupported":
    case "indeterminate":
      return `Closes the conversation (${m.kind}): ${str(b.reason) ?? "no reason"}.`;
    case "invoke":
      return "Invokes an operation.";
  }
  return "A message.";
}

function termsOf(m: AnyMessage): JsonObject | undefined {
  const b = m.body as unknown as JsonObject;
  if (m.kind === "propose") return b.terms as JsonObject;
  if (m.kind === "deliver" || m.kind === "invoke") return b.basis as JsonObject;
  if (m.kind === "accept") return { termsDigest: b.termsDigest ?? null };
  return undefined;
}

function termsSummary(t: JsonObject | undefined): string {
  if (!t) return "No terms travel with this message.";
  if (t.kind === "agreement")
    return `Sent under agreement ${str(t.agreement)}; its terms bind the data.`;
  if ("termsDigest" in t && Object.keys(t).length === 1)
    return "Binds to the offered terms by their digest.";
  const parts: string[] = [];
  if (typeof t.purpose === "string") parts.push(`purpose ${t.purpose.split(/[#/]/).pop()}`);
  if (typeof t.retentionDays === "number") parts.push(`kept at most ${t.retentionDays} days`);
  if (Array.isArray(t.prohibitedPurposes) && t.prohibitedPurposes.length > 0)
    parts.push(
      `never for ${t.prohibitedPurposes.map((p) => String(p).split(/[#/]/).pop()).join(", ")}`,
    );
  if (Array.isArray(t.onward) && t.onward.length > 0)
    parts.push(`passed on only to ${t.onward.length} named recipient(s)`);
  return parts.length > 0
    ? `Terms: ${parts.join("; ")}.`
    : "Terms of the offer (operation model fields).";
}

/** Build the inspector view of a message as it crossed the carriage. */
export function packetView(
  message: AnyMessage,
  wire: WireMessage | undefined,
  opts: {
    carriageSuite: string;
    carriageSummary: string;
    name: Namer;
    vocabulary?: ContentVocabulary;
    known?: KnownContent;
  },
): PacketView {
  const { name } = opts;
  const signed = wire?.format === "awp-jws-compact/0.1";
  const jwsHeader = signed ? decodeJws(wire.jws).header : undefined;
  const reps = evidenceOf(message, "representation");
  const creds = evidenceOf(message, "credential");
  const terms = termsOf(message);
  const header: PacketLayerView = {
    present: true,
    summary: `From ${name(message.from.actor)} to ${name(message.to?.actor)}; ${message.kind}; ${
      signed
        ? `signed (JWS ${str(jwsHeader?.alg)}, pinned key ${str(jwsHeader?.kid)?.slice(0, 12)}…)`
        : "unsigned"
    }; valid ${message.createdAt} to ${message.expiresAt}; one-time id ${message.id}.`,
    raw: {
      profile: message.profile,
      configuration: message.configuration,
      id: message.id,
      conversation: message.conversation,
      kind: message.kind,
      from: message.from,
      ...(message.to ? { to: message.to } : {}),
      createdAt: message.createdAt,
      expiresAt: message.expiresAt,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(jwsHeader ? { proof: jwsHeader } : {}),
    },
    digest: digestOf(message),
  };
  const authority: PacketLayerView =
    reps.length > 0
      ? {
          present: true,
          summary: `${reps.length} representation statement(s): ${reps
            .map((r) => `${name(str(r.party))} says ${name(str(r.actor))} acts for it`)
            .join("; ")}.`,
          raw: reps,
          digest: digestOf(reps),
        }
      : { present: false, summary: "No statement of who the sender acts for." };
  const freeText = freeMessageStrings(message, opts.vocabulary, opts.known);
  const content: PacketLayerView = {
    present: true,
    summary: contentSummary(message, name, opts.vocabulary, opts.known),
    raw: message.body,
    digest: digestOf(message.body as unknown as JsonObject),
    ...(freeText.length > 0 ? { untrusted: freeText } : {}),
  };
  const evidence: PacketLayerView =
    creds.length > 0
      ? {
          present: true,
          summary: `${creds.length} statement(s) signed by their sources: ${creds
            .map((c) => `${str(c.claimType)} from ${name(str(c.issuer))}`)
            .join("; ")}.`,
          raw: creds,
          digest: digestOf(creds),
        }
      : { present: false, summary: "No third-party statements." };
  const termsView: PacketLayerView = terms
    ? { present: true, summary: termsSummary(terms), raw: terms, digest: digestOf(terms) }
    : { present: false, summary: termsSummary(undefined) };
  const asOf = creds.map((c) => str(c.asOf) ?? str(c.issuedAt)).filter(Boolean);
  const provenance: PacketLayerView = {
    present: Boolean(message.inReplyTo) || creds.length > 0,
    summary: [
      message.inReplyTo ? `Answers ${message.inReplyTo}.` : "Opens or continues the conversation.",
      creds.length > 0
        ? `The statements were issued by their sources and are relayed, not authored, by ${name(message.from.actor)}; as of ${asOf.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    raw: {
      conversation: message.conversation,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(creds.length > 0
        ? {
            statements: creds.map((c) => ({
              id: c.id ?? null,
              issuer: c.issuer ?? null,
              issuedAt: c.issuedAt ?? null,
              asOf: c.asOf ?? null,
            })),
          }
        : {}),
    },
  };
  return {
    id: message.id,
    from: name(message.from.actor),
    to: name(message.to?.actor),
    kind: message.kind,
    carriage: {
      suite: opts.carriageSuite,
      summary: `${opts.carriageSummary}${wire ? ` Carries ${digestBytes(JSON.stringify(wire)).slice(0, 19)}…; never trusted.` : ""}`,
    },
    layers: { header, authority, content, evidence, terms: termsView, provenance },
  };
}
