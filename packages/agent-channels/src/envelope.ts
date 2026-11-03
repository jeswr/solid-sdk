// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT, canonicalJson, DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { ChannelParseError } from "./errors.js";

/** Shared Slack event type and Matrix content key, DESIGN §3.2. */
export const ENVELOPE_KEY = "org.jeswr.agent.envelope";
export interface SignedEnvelope {
  readonly "@context": { readonly agent: typeof AGENT };
  readonly "@type": "agent:SignedMessage";
  readonly "agent:wireFormat": "jws-compact";
  readonly "agent:compactJws": string;
}
const limits = Object.freeze({
  ...DEFAULT_LIMITS,
  maxStringLength: DEFAULT_LIMITS.maxEnvelopeBytes,
});

/** Read only own JSON data properties; never invoke accessors or coercion hooks. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object")
    throw new ChannelParseError("invalid carrier object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new ChannelParseError("invalid carrier object");
  if (Reflect.ownKeys(value).length !== keys.length)
    throw new ChannelParseError("invalid carrier fields");
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new ChannelParseError("invalid carrier fields");
    out[key] = descriptor.value;
  }
  return out;
}
function assertCompact(compactJws: string): void {
  if (
    typeof compactJws !== "string" ||
    compactJws.length > limits.maxEnvelopeBytes ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws)
  )
    throw new ChannelParseError("invalid signed-message carrier");
}
/** Pure codec: encoding and decoding never verify a signature or grant authority. */
export function encodeEnvelopeObject(compactJws: string): SignedEnvelope {
  assertCompact(compactJws);
  const value: SignedEnvelope = {
    "@context": { agent: AGENT },
    "@type": "agent:SignedMessage",
    "agent:wireFormat": "jws-compact",
    "agent:compactJws": compactJws,
  };
  if (Buffer.byteLength(canonicalJson(value)) > limits.maxEnvelopeBytes)
    throw new ChannelParseError("signed-message carrier exceeds byte cap");
  return value;
}
export function decodeEnvelopeObject(value: unknown): string {
  const v = fields(value, ["@context", "@type", "agent:wireFormat", "agent:compactJws"]);
  const context = fields(v["@context"], ["agent"]);
  if (
    context.agent !== AGENT ||
    v["@type"] !== "agent:SignedMessage" ||
    v["agent:wireFormat"] !== "jws-compact"
  )
    throw new ChannelParseError("invalid signed-message context or format");
  const compactJws = v["agent:compactJws"] as string;
  encodeEnvelopeObject(compactJws);
  return compactJws;
}
/** Canonical JSON-LD for email MIME parts, inline scripts and native carriages. */
export function encodeEnvelope(compactJws: string): string {
  return canonicalJson(encodeEnvelopeObject(compactJws));
}
export function decodeEnvelope(raw: string | Uint8Array): { text: string; compactJws: string } {
  try {
    if (typeof raw !== "string" && raw.byteLength > limits.maxEnvelopeBytes)
      throw new ChannelParseError("signed-message carrier exceeds byte cap");
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { text, compactJws: decodeEnvelopeObject(parseBoundedJson(text, limits)) };
  } catch {
    throw new ChannelParseError("invalid signed-message carrier");
  }
}
/** Slack metadata; Teams may place encodeEnvelopeObject's result in card data. */
export function encodeMetadataField(compactJws: string) {
  return { event_type: ENVELOPE_KEY, event_payload: encodeEnvelopeObject(compactJws) };
}
export function decodeMetadataField(value: unknown): string {
  const v = fields(value, ["event_type", "event_payload"]);
  if (v.event_type !== ENVELOPE_KEY) throw new ChannelParseError("invalid metadata event type");
  return decodeEnvelopeObject(v.event_payload);
}
/** Matrix content; callers merge this field with body/msgtype before encryption. */
export function encodeEventContent(compactJws: string) {
  return { [ENVELOPE_KEY]: encodeEnvelopeObject(compactJws) };
}
export function decodeEventContent(value: unknown): string {
  // Accept the complete event content, but inspect only our own data property.
  const descriptor =
    value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, ENVELOPE_KEY)
      : undefined;
  if (!descriptor?.enumerable || !("value" in descriptor))
    throw new ChannelParseError("missing envelope content");
  return decodeEnvelopeObject(descriptor.value);
}
