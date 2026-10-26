/**
 * Email binding (email-mime/0.1): carries one signed interaction message over ordinary
 * email with a human-readable fallback.
 *
 * Outbound MIME (built here; every header value is generated or validated, never copied
 * from input):
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain  — the human fallback: an explicit "software agent / synthetic test"
 *                     label plus a summary rendered deterministically from the payload
 *       text/html   — the same text in <pre> + an inline JSON-LD carrier <script>
 *     application/ld+json attachment — the same carrier
 * The carrier is a tiny self-contained JSON-LD object wrapping the compact JWS. It is
 * JSON-LD only so the existing hardened parser (`@jeswr/agentic-legacy-bridge`
 * `parseEmail`, which surfaces `application/ld+json` parts and inline script blocks)
 * extracts it; no JSON-LD processing is performed and the core model does not depend on it.
 *
 * Inbound rules (precedence and conflicts, framework E):
 *  - the signed structured copy is authoritative; the human text is never parsed for intent;
 *  - no structured copy → `no-structured-content` (a plain email; nothing is automated);
 *  - two structured copies that differ, or a malformed one → `conflicting-structured-copies`;
 *  - STRICT parity (default): the message must have exactly the supported MIME layout, and
 *    EVERY human-visible part must equal the rendering this binding derives from the signed
 *    payload — the text/plain part byte-for-byte (line endings normalised), the text/html
 *    part exactly (so no hidden, extra or differently displayed text), and the attachment
 *    must be the same carrier — otherwise `human-parity-mismatch`. A person reading any
 *    part is shown exactly the terms the agents act on. This rejects forwarded, quoted or
 *    client-rewritten mail, by design;
 *  - LENIENT parity (opt-in): other layouts are accepted with parity `unverified` — the
 *    signed structured copy still governs; nothing is claimed about the human text;
 *  - From/To headers are recorded as unauthenticated observations only; replies go to the
 *    endpoint pinned for the peer actor, never to an inbound Reply-To.
 *
 * Outbound, {@link validateOutboundEmail} re-derives and checks the exact bytes a provider
 * would send: layout, the complete top-level header set (no Cc/Bcc/Resent/Reply-To/etc.),
 * sender, single recipient, structured copy and parity.
 */
import { createHash, randomBytes } from "node:crypto";
import { isValidEmailAddress, parseEmail } from "@jeswr/agentic-legacy-bridge";
import { digestBytes } from "../core/canonical.js";
import { BoundsError, DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import type { AnyMessage, JsonObject, ReasonCode } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import type { OutboundMessage } from "../runtime/agent.js";
import type { WireMessage } from "../store/state.js";
import { headerValues, leaves, type MimeNode, parseMime, shapeOf } from "./mime.js";

export const EMAIL_BINDING = "email-mime/0.1";
const SUMMARY_START = "--- Summary generated from the signed statement ---";
const SUMMARY_END = "--- End of summary ---";

const CARRIER_CONTEXT = {
  awp: AWP,
  SignedMessage: "awp:SignedMessage",
  format: "awp:wireFormat",
  jws: "awp:compactJws",
} as const;

function short(v: unknown, max = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return (s ?? "").length > max ? `${(s ?? "").slice(0, max - 3)}...` : (s ?? "");
}

/** Deterministic, parity-critical summary lines for one message. */
export function summaryLines(m: AnyMessage): string[] {
  const lines = [`Kind: ${m.kind}`, `Conversation: ${m.conversation}`, `Message: ${m.id}`];
  if (m.inReplyTo) lines.push(`In reply to: ${m.inReplyTo}`);
  switch (m.kind) {
    case "propose": {
      lines.push(
        `Operation: ${m.body.operation.id} v${m.body.operation.version}`,
        `Round: ${m.body.round}`,
        `Terms digest: ${m.body.termsDigest}`,
      );
      const t = m.body.terms as JsonObject;
      for (const key of Object.keys(t).sort()) {
        if (key === "candidates" && Array.isArray(t[key])) {
          lines.push("Candidate times (UTC):");
          for (const c of t[key] as JsonObject[])
            lines.push(`  - ${String(c.start)} to ${String(c.end)}`);
        } else {
          lines.push(`Term ${key}: ${short(t[key])}`);
        }
      }
      break;
    }
    case "accept":
      lines.push(
        `Accepts proposal: ${m.body.proposal}`,
        `Terms digest: ${m.body.termsDigest}`,
        `Agreement: ${m.body.agreement}`,
      );
      if (m.body.selection) lines.push(`Selection: ${short(m.body.selection, 300)}`);
      break;
    case "refuse":
    case "unsupported":
    case "indeterminate":
      lines.push(`Reason: ${m.body.reason}`);
      if (m.body.detail) lines.push(`Detail: ${short(m.body.detail, 300)}`);
      break;
    case "invoke":
      lines.push(
        `Operation: ${m.body.operation.id} v${m.body.operation.version}`,
        `Basis: ${m.body.basis.kind}`,
      );
      if (m.body.purpose) lines.push(`Purpose: ${m.body.purpose}`);
      break;
    case "deliver":
      lines.push(
        `Operation: ${m.body.operation.id} v${m.body.operation.version}`,
        `Output fields: ${Object.keys(m.body.output).sort().join(", ")}`,
      );
      break;
    case "receipt":
      lines.push(
        `Activity: ${m.body.activity}`,
        `Outcome: ${m.body.outcome}${m.body.final ? " (final)" : ""}`,
      );
      if (m.body.observed) lines.push(`Observed: ${short(m.body.observed, 300)}`);
      break;
    case "describe":
      lines.push("Request: implementation description");
      break;
    case "description":
      lines.push("Content: implementation description (advertises support; grants nothing)");
      break;
  }
  return lines;
}

/**
 * The full human fallback text — a deterministic function of the signed message, so any
 * receiver can re-derive it. Labels software representation and synthetic scope.
 */
export function renderHuman(m: AnyMessage): string {
  const actor = m.from.actor ?? "an anonymous client";
  const party = m.from.onBehalfOf
    ? `on behalf of ${m.from.onBehalfOf}`
    : "without a represented party";
  return [
    "AUTOMATED MESSAGE - SYNTHETIC TEST",
    "",
    `This email was generated by a software agent (${actor}) ${party}.`,
    `Operator: ${m.from.operator ?? "not disclosed"}.`,
    "It is part of a synthetic pilot between test accounts controlled by the same person.",
    "It has no legal, commercial, booking or payment effect.",
    "This label is not evidence of authority. The receiving agent acts only on the attached",
    `signed statement (profile ${m.profile}), after its own verification and policy checks.`,
    "",
    SUMMARY_START,
    ...summaryLines(m),
    SUMMARY_END,
    "",
    "A person may reply in plain text. A reply without the signed attachment is not acted on",
    "automatically.",
  ].join("\n");
}

function b64lines(text: string): string {
  return (
    Buffer.from(text, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? [""]
  ).join("\r\n");
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON safe inside <script>: escape <, >, & and line separators. */
function scriptSafe(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function asciiHeader(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
}

export interface BuiltEmail {
  readonly raw: string;
  readonly emailMessageId: string;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
}

export function carrierFor(wire: WireMessage): string {
  if (wire.format !== "awp-jws-compact/0.1")
    throw new Error("the email binding carries signed messages only");
  return JSON.stringify({
    "@context": CARRIER_CONTEXT,
    "@type": "SignedMessage",
    format: wire.format,
    jws: wire.jws,
  });
}

/** The three renderings of one signed message (all derived deterministically). */
export function renderBodies(
  m: AnyMessage,
  wire: WireMessage,
): { human: string; html: string; carrier: string } {
  const human = renderHuman(m);
  const carrier = carrierFor(wire);
  const html = `<!doctype html><html><body><pre>${htmlEscape(human)}</pre><script type="application/ld+json">${scriptSafe(carrier)}</script></body></html>`;
  return { human, html, carrier };
}

/**
 * The RFC 5322 Message-ID for one protocol message: derived from the message id, so every
 * rendering of the same message (including re-emission after recovery) carries the same
 * provider-visible identifier — the key for reconciling an uncertain provider send.
 */
export function emailMessageIdFor(messageId: string): string {
  return `<awp-${createHash("sha256").update(messageId, "utf8").digest("hex").slice(0, 40)}@awp-pilot.invalid>`;
}

/** The only MIME layout accepted under strict parity. */
export const SUPPORTED_SHAPE =
  "multipart/mixed(multipart/alternative(text/plain,text/html),application/ld+json)";

/** Build the outbound MIME for one message. `to` must be a pinned endpoint. */
export function buildEmail(input: {
  out: OutboundMessage;
  from: string;
  to: string;
  date: Date;
  inReplyToEmailId?: string;
  references?: readonly string[];
}): BuiltEmail {
  if (!isValidEmailAddress(input.from) || !isValidEmailAddress(input.to))
    throw new Error("invalid email address");
  const m = input.out.message;
  const { human, html, carrier } = renderBodies(m, input.out.wire);
  const mixed = `awp-mixed-${randomBytes(8).toString("hex")}`;
  const alt = `awp-alt-${randomBytes(8).toString("hex")}`;
  const emailMessageId = emailMessageIdFor(m.id);
  const op =
    "operation" in m.body
      ? (m.body as { operation: { id: string } }).operation.id.split("/").at(-1)
      : undefined;
  const subject = asciiHeader(`[AWP synthetic] ${m.kind}${op ? `: ${op}` : ""}`);
  const threadIds = [
    ...(input.references ?? []),
    ...(input.inReplyToEmailId ? [input.inReplyToEmailId] : []),
  ]
    .filter((id) => /^<[^<>\s]{1,250}>$/.test(id))
    .slice(-10);
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    `Date: ${input.date.toUTCString()}`,
    `Message-ID: ${emailMessageId}`,
    ...(input.inReplyToEmailId && /^<[^<>\s]{1,250}>$/.test(input.inReplyToEmailId)
      ? [`In-Reply-To: ${input.inReplyToEmailId}`]
      : []),
    ...(threadIds.length > 0 ? [`References: ${threadIds.join(" ")}`] : []),
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `X-AWP-Profile: ${asciiHeader(m.profile)}`,
    `X-AWP-Conversation: ${asciiHeader(m.conversation)}`,
    `X-AWP-Message: ${asciiHeader(m.id)}`,
    "X-AWP-Synthetic-Test: true",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const body = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(human),
    `--${alt}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(html),
    `--${alt}--`,
    `--${mixed}`,
    "Content-Type: application/ld+json; charset=utf-8",
    'Content-Disposition: attachment; filename="awp-message.jsonld"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(carrier),
    `--${mixed}--`,
    "",
  ];
  return {
    raw: [...headers, "", ...body].join("\r\n"),
    emailMessageId,
    subject,
    from: input.from,
    to: input.to,
  };
}

/** Gmail API `users.messages.send` request body for a built email. */
export function gmailSendPayload(
  email: BuiltEmail,
  threadId?: string,
): { raw: string; threadId?: string } {
  return {
    raw: Buffer.from(email.raw, "utf8").toString("base64url"),
    ...(threadId ? { threadId } : {}),
  };
}

/** Raw bytes from a Gmail API `users.messages.get?format=raw` response body. */
export function rawFromGmailMessage(value: unknown): Buffer {
  if (!value || typeof value !== "object") throw new Error("not a Gmail message object");
  const raw = (value as { raw?: unknown }).raw;
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw))
    throw new Error("missing or invalid raw field");
  return Buffer.from(raw, "base64url");
}

export type Parity = "match" | "unverified" | "unchecked";

export type InboundEmailResult =
  | {
      readonly ok: true;
      readonly wire: WireMessage;
      readonly email: EmailObservation;
      /**
       * `match` — strict layout and exact human/structured parity;
       * `unverified` — lenient mode, other layout or text: only the signed copy is trusted;
       * `unchecked` — the payload could not be decoded (the runtime then rejects it).
       */
      readonly parity: Parity;
      readonly parityDetail?: string;
      readonly structuredCopies: number;
    }
  | {
      readonly ok: false;
      readonly reason: ReasonCode;
      readonly detail: string;
      readonly email?: EmailObservation;
      readonly structuredCopies?: number;
    };

export interface EmailObservation {
  readonly rawSha256: string;
  readonly from?: string;
  readonly to: readonly string[];
  readonly subject?: string;
  readonly emailMessageId?: string;
  readonly inReplyTo?: string;
  readonly warnings: readonly string[];
  readonly note: string;
}

function lines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/** Decode a compact JWS payload into a validated message (unverified; for rendering only). */
function messageOf(jws: string): AnyMessage | undefined {
  try {
    const payloadText = Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8");
    const checked = validateMessage(parseBoundedJson(payloadText, DEFAULT_LIMITS));
    return checked.ok ? checked.message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exact parity of every human-visible part with the renderings derived from `wire`.
 * Returns undefined when the email matches, else what differs.
 */
export function parityProblem(
  root: MimeNode,
  message: AnyMessage,
  wire: WireMessage,
): string | undefined {
  const shape = shapeOf(root);
  if (shape !== SUPPORTED_SHAPE) return `unsupported MIME layout ${shape}`;
  const expected = renderBodies(message, wire);
  const [plain, html, carrier] = leaves(root);
  if (lines(plain?.text ?? "") !== lines(expected.human))
    return "text/plain part differs from the signed statement's rendering";
  if (lines(html?.text ?? "") !== lines(expected.html))
    return "text/html part differs from the signed statement's rendering";
  if (lines(carrier?.text ?? "") !== lines(expected.carrier))
    return "attachment differs from the structured copy";
  for (const leaf of leaves(root)) {
    const extra = leaf.headers.filter(
      ([n]) => !["content-type", "content-transfer-encoding", "content-disposition"].includes(n),
    );
    if (extra.length > 0) return `unexpected part header ${extra[0]?.[0]}`;
  }
  return undefined;
}

/** Parse a provider-delivered email into a wire message, applying the binding rules. */
export function parseInboundEmail(
  raw: string | Uint8Array,
  options: { strictParity?: boolean } = {},
): InboundEmailResult {
  const strict = options.strictParity ?? true;
  let parsed: ReturnType<typeof parseEmail>;
  try {
    parsed = parseEmail(raw);
  } catch (error) {
    return { ok: false, reason: "bounds-exceeded", detail: (error as Error).message };
  }
  const email: EmailObservation = {
    rawSha256: `sha-256:${parsed.rawSha256}`,
    ...(parsed.from ? { from: parsed.from.address } : {}),
    to: parsed.to.map((a) => a.address),
    ...(parsed.subject ? { subject: parsed.subject } : {}),
    ...(parsed.messageId ? { emailMessageId: `<${parsed.messageId}>` } : {}),
    ...(parsed.inReplyTo ? { inReplyTo: `<${parsed.inReplyTo}>` } : {}),
    warnings: parsed.warnings,
    note: "email headers are unauthenticated observations; they carry no authority",
  };
  const copies = new Set<string>();
  let claimed = 0;
  for (const block of parsed.jsonLdBlocks ?? []) {
    let value: unknown;
    try {
      value = parseBoundedJson(block, DEFAULT_LIMITS);
    } catch (error) {
      if (block.includes("SignedMessage")) {
        return {
          ok: false,
          reason:
            error instanceof BoundsError && error.code !== "not-json"
              ? "bounds-exceeded"
              : "conflicting-structured-copies",
          detail: "a structured copy is malformed",
          email,
        };
      }
      continue;
    }
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>)["@type"] !== "SignedMessage"
    )
      continue;
    claimed++;
    const v = value as Record<string, unknown>;
    if (v.format !== "awp-jws-compact/0.1" || typeof v.jws !== "string") {
      return {
        ok: false,
        reason: "conflicting-structured-copies",
        detail: "a structured copy has an unknown format",
        email,
      };
    }
    copies.add(v.jws.trim());
  }
  if (copies.size === 0) {
    return {
      ok: false,
      reason: "no-structured-content",
      detail: "plain email; nothing to act on automatically",
      email,
      structuredCopies: 0,
    };
  }
  if (copies.size > 1) {
    return {
      ok: false,
      reason: "conflicting-structured-copies",
      detail: `${copies.size} different signed copies`,
      email,
      structuredCopies: claimed,
    };
  }
  const jws = [...copies][0] as string;
  const wire: WireMessage = { format: "awp-jws-compact/0.1", jws };
  const message = messageOf(jws);
  if (!message) return { ok: true, wire, email, parity: "unchecked", structuredCopies: claimed };
  const mime = parseMime(raw);
  const problem = mime.ok
    ? parityProblem(mime.root, message, wire)
    : `unparseable MIME: ${mime.detail}`;
  if (problem) {
    if (strict) {
      return {
        ok: false,
        reason: "human-parity-mismatch",
        detail: problem,
        email,
        structuredCopies: claimed,
      };
    }
    return {
      ok: true,
      wire,
      email,
      parity: "unverified",
      parityDetail: problem,
      structuredCopies: claimed,
    };
  }
  return { ok: true, wire, email, parity: "match", structuredCopies: claimed };
}

/** Top-level headers this binding emits. Anything else in an outbound message is refused. */
const OUTBOUND_HEADERS = new Set([
  "from",
  "to",
  "subject",
  "date",
  "message-id",
  "in-reply-to",
  "references",
  "mime-version",
  "auto-submitted",
  "x-awp-profile",
  "x-awp-conversation",
  "x-awp-message",
  "x-awp-synthetic-test",
  "content-type",
]);
const REQUIRED_OUTBOUND = [
  "from",
  "to",
  "subject",
  "date",
  "message-id",
  "mime-version",
  "auto-submitted",
  "content-type",
];

/**
 * Re-validate the exact bytes a provider would send, from first principles (never from a
 * review status string): supported layout; exactly the headers this binding emits, each
 * once (so no Cc, Bcc, Resent-*, Sender, Reply-To or smuggled recipients); `From` equal to
 * the configured source account; exactly one `To` equal to the expected pinned endpoint;
 * the structured copy equal to `expected.jws`; exact parity of every human-visible part.
 */
export function validateOutboundEmail(
  raw: string | Uint8Array,
  expected: { from: string; to: string; jws: string },
): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const mime = parseMime(raw);
  if (!mime.ok) return { ok: false, problems: [`unparseable MIME: ${mime.detail}`] };
  const counts = new Map<string, number>();
  for (const [name] of mime.root.headers) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, n] of counts) {
    if (!OUTBOUND_HEADERS.has(name)) problems.push(`header not emitted by this binding: ${name}`);
    if (n > 1) problems.push(`header repeated: ${name}`);
  }
  for (const name of REQUIRED_OUTBOUND)
    if (!counts.has(name)) problems.push(`missing header: ${name}`);
  const from = headerValues(mime.root, "from")[0];
  const to = headerValues(mime.root, "to")[0];
  if (from !== expected.from) problems.push("From is not the configured source account");
  if (to !== expected.to || !isValidEmailAddress(to ?? ""))
    problems.push("To is not exactly the expected single pinned recipient");
  const message = messageOf(expected.jws);
  if (!message) problems.push("structured copy does not decode");
  else {
    if (headerValues(mime.root, "message-id")[0] !== emailMessageIdFor(message.id))
      problems.push("Message-ID is not the one derived from the signed message id");
    if (headerValues(mime.root, "x-awp-message")[0] !== message.id)
      problems.push("X-AWP-Message is not the signed message id");
    const wire: WireMessage = { format: "awp-jws-compact/0.1", jws: expected.jws };
    const problem = parityProblem(mime.root, message, wire);
    if (problem) problems.push(problem);
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Positive evidence that a provider-stored copy is the message this agent sent: parsed by
 * the inbound path (hardened parser, strict human parity), it carries exactly the expected
 * signed envelope, the derived Message-ID, `From` the source account and exactly one `To`, the
 * pinned recipient, and every top-level header of the message as sent (`sent`) is present
 * with the same values. Providers may ADD headers, so this is a bound check, not byte equality.
 */
export function verifyProviderCopy(
  raw: Uint8Array,
  expected: { from: string; to: string; jws: string; emailMessageId: string; sent: Uint8Array },
): { ok: true } | { ok: false; detail: string } {
  const parsed = parseInboundEmail(raw, { strictParity: true });
  if (!parsed.ok) return { ok: false, detail: `${parsed.reason}: ${parsed.detail}` };
  if (parsed.parity !== "match") return { ok: false, detail: "human parity not verified" };
  if (parsed.wire.format !== "awp-jws-compact/0.1" || parsed.wire.jws !== expected.jws)
    return { ok: false, detail: "signed envelope differs" };
  if (parsed.email.emailMessageId !== expected.emailMessageId)
    return { ok: false, detail: "Message-ID differs" };
  if (parsed.email.from !== expected.from) return { ok: false, detail: "From differs" };
  if (parsed.email.to.length !== 1 || parsed.email.to[0] !== expected.to)
    return { ok: false, detail: "recipients differ" };
  const mime = parseMime(raw);
  if (!mime.ok) return { ok: false, detail: "unparseable MIME" };
  for (const name of ["cc", "bcc", "resent-to", "resent-cc", "resent-bcc"])
    if (headerValues(mime.root, name).length > 0)
      return { ok: false, detail: `unexpected recipient header ${name}` };
  const sent = parseMime(expected.sent);
  if (!sent.ok) return { ok: false, detail: "the sent message does not parse" };
  for (const name of new Set(sent.root.headers.map(([n]) => n))) {
    const want = headerValues(sent.root, name);
    const got = headerValues(mime.root, name);
    if (want.length !== got.length || want.some((v, k) => v !== got[k]))
      return { ok: false, detail: `header ${name} differs from the message sent` };
  }
  return { ok: true };
}

export function emailDigest(raw: string | Uint8Array): string {
  return digestBytes(raw);
}
