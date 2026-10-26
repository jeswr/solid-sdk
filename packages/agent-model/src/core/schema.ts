// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Structural validation of decoded messages. Strict: an unknown field anywhere in the
 * envelope or a core body is refused (`unsupported-term`), because an unrecognised
 * consequential term must not be silently ignored (A3). Domain terms inside `terms`,
 * `input` and `output` are validated by the operation's own schema.
 */
import { z } from "zod";
import { jsonObject } from "./json.js";
import {
  type AnyMessage,
  MESSAGE_KINDS,
  type MessageKind,
  REASON_CODES,
  type ReasonCode,
} from "./types.js";

const MAX_ID = 512;

/** An ISO-8601 instant with an explicit offset (`Z` or `±hh:mm`). */
export function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export const iso = z.string().max(64).refine(isIsoInstant, "expected ISO-8601 instant");
export const id = z
  .string()
  .min(3)
  .max(MAX_ID)
  .regex(/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i, "expected an absolute IRI/URN");
const reason = z.enum(REASON_CODES as unknown as [ReasonCode, ...ReasonCode[]]);
const operationRef = z.strictObject({ id, version: z.string().min(1).max(32) });
const detail = z.string().max(1024).optional();

const basis = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("agreement"), agreement: id }),
  z.strictObject({ kind: z.literal("public") }),
  z.strictObject({ kind: z.literal("represented") }),
  z.strictObject({ kind: z.literal("grant"), grant: id }),
  z.strictObject({ kind: z.literal("invocation"), invocation: id }),
]);

const bodies = {
  describe: z.strictObject({ want: z.array(z.string().max(128)).max(16).optional() }),
  description: z.strictObject({ description: jsonObject }),
  propose: z.strictObject({
    operation: operationRef,
    terms: jsonObject,
    termsDigest: z.string().max(128),
    round: z.number().int().min(1).max(64),
    counters: id.optional(),
  }),
  accept: z.strictObject({
    proposal: id,
    termsDigest: z.string().max(128),
    selection: jsonObject.optional(),
    agreement: id,
  }),
  refuse: z.strictObject({ ref: id, reason, detail }),
  invoke: z.strictObject({
    operation: operationRef,
    input: jsonObject,
    basis,
    purpose: id.optional(),
  }),
  deliver: z.strictObject({ ref: id, basis, operation: operationRef, output: jsonObject }),
  receipt: z.strictObject({
    ref: id,
    activity: id,
    outcome: z.enum(["completed", "not-executed", "uncertain"]),
    observed: jsonObject.optional(),
    final: z.boolean().optional(),
  }),
  unsupported: z.strictObject({ ref: id, reason, detail }),
  indeterminate: z.strictObject({ ref: id, reason, detail }),
} satisfies Record<MessageKind, z.ZodType>;

const evidenceItem = z.strictObject({
  role: z.enum([
    "representation",
    "approval",
    "credential",
    "grant",
    "membership",
    "authorisation",
  ]),
  format: z.string().min(1).max(64),
  value: z
    .string()
    .min(1)
    .max(16 * 1024),
});

const envelope = z.strictObject({
  profile: id,
  configuration: id,
  id,
  conversation: id,
  kind: z.enum(MESSAGE_KINDS as unknown as [MessageKind, ...MessageKind[]]),
  from: z.strictObject({
    actor: id.optional(),
    onBehalfOf: id.optional(),
    operator: id.optional(),
  }),
  to: z.strictObject({ actor: id, party: id.optional() }).optional(),
  createdAt: iso,
  expiresAt: iso,
  inReplyTo: id.optional(),
  body: jsonObject,
  evidence: z.array(evidenceItem).max(64).optional(),
});

export type SchemaResult =
  | { readonly ok: true; readonly message: AnyMessage }
  | { readonly ok: false; readonly reason: ReasonCode; readonly detail: string };

/** Validate a decoded payload as a {@link AnyMessage}. */
export function validateMessage(value: unknown): SchemaResult {
  const outer = envelope.safeParse(value);
  if (!outer.success) {
    const unknownKey = outer.error.issues.some((i) => i.code === "unrecognized_keys");
    return {
      ok: false,
      reason: unknownKey ? "unsupported-term" : "malformed",
      detail: summarise(outer.error),
    };
  }
  const kind = outer.data.kind;
  const inner = bodies[kind].safeParse(outer.data.body);
  if (!inner.success) {
    const unknownKey = inner.error.issues.some((i) => i.code === "unrecognized_keys");
    return {
      ok: false,
      reason: unknownKey ? "unsupported-term" : "malformed",
      detail: `${kind} body: ${summarise(inner.error)}`,
    };
  }
  return { ok: true, message: { ...outer.data, body: inner.data } as unknown as AnyMessage };
}

function summarise(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ")
    .slice(0, 512);
}
