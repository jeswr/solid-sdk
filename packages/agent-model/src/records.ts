// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Strict channel-neutral pod records. Parsing establishes structure, never authority. */
import { z } from "zod";
import { isIri } from "./core/canonical.js";
import { isJsonObject, json, jsonObject } from "./core/json.js";
import { iso } from "./core/schema.js";

// Keep the instant profile (four-digit year, explicit zone, up to nine fractional
// digits), with XSD dateTime's required seconds and +/-14:00 timezone bound.
const xsdDateTime =
  /^\d{4}-\d{2}-\d{2}T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?|24:00:00(?:\.0{1,9})?)(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
// Date.parse normalizes impossible days; reject those without changing the text.
const instant = iso.refine((value) => {
  if (!xsdDateTime.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}, "expected a valid xsd:dateTime instant");

const iri = z.string().min(3).max(2048).refine(isIri, "expected absolute IRI");
const text = z.string().max(16384);
const nonempty = text.min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const money = z.number().finite().nonnegative();
type JsonValue = z.infer<ReturnType<typeof z.json>>;
const proof = json.optional();
export const bindingStateSchema = z.enum([
  "none",
  "setup-required",
  "connected",
  "error",
  "disabled",
]);
export const restrictionsSchema = z.strictObject({
  read: z.boolean(),
  triage: z.boolean(),
  draft: z.boolean(),
  send: z.boolean(),
});
/** Exact action terms; recipient identifiers are salted hashes, never handles. */
export const actionIntentSchema = z.strictObject({
  operation: iri,
  operationVersion: nonempty,
  action: nonempty,
  target: iri,
  binding: nonempty,
  recipientHash: nonempty,
  amount: z.strictObject({
    value: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  purpose: iri,
  termsDigest: nonempty,
  parameters: jsonObject,
  conversation: iri,
});

/** Registry observations are inventory, never owner settings or evidence of live access. */
export const accountInventorySchema = z.strictObject({
  channelHandles: z.array(nonempty).max(20),
  credentialRefs: z.array(nonempty).max(20),
  setupStatus: nonempty,
  observedAt: text.optional(),
  lastTested: text.optional(),
  evidence: z
    .array(
      z.strictObject({
        channel: nonempty,
        provider: nonempty,
        handleHash: nonempty,
        observedOn: nonempty,
        method: text,
      }),
    )
    .max(512),
  identityConflicts: z
    .array(
      z.strictObject({
        kind: z.enum(["identity-mismatch", "provider-mismatch"]),
        handleHashes: z.array(nonempty).max(512),
      }),
    )
    .max(512),
});
export type AccountInventory = z.infer<typeof accountInventorySchema>;

const account = z
  .strictObject({
    type: z.literal("account"),
    id: iri,
    channel: nonempty,
    provider: nonempty,
    organisation: text.optional(),
    label: text.optional(),
    channelHandleHash: nonempty.optional(),
    bindingState: bindingStateSchema,
    credentialRef: nonempty.optional(),
    restrictions: restrictionsSchema,
    inventory: accountInventorySchema.optional(),
  })
  .refine(
    (value) =>
      value.channelHandleHash !== undefined || value.inventory?.channelHandles.length === 0,
    "an account without a handle must have an empty inventory handle list",
  );
const channelCapability = z.strictObject({
  type: z.literal("channel-capability"),
  id: iri,
  channel: nonempty,
  binding: nonempty,
  carriage: nonempty,
  structuredPayload: z.boolean(),
  endToEndEncrypted: z.boolean(),
  deliveryReceipts: z.boolean(),
  historyWindow: z
    .string()
    .max(128)
    .regex(
      /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/,
    ),
  maxMessageBytes: count,
  sendSupported: z.boolean(),
  costPerMessage: money,
  rateLimit: z.strictObject({ perRecipient: count, perDay: count }),
  credentialState: bindingStateSchema,
  lastIngest: instant.optional(),
});
const inboundMessage = z.strictObject({
  type: z.literal("inbound-message"),
  id: iri,
  channel: nonempty,
  binding: nonempty,
  wasDerivedFrom: iri,
  rawSha256: nonempty,
  rawByteLength: count,
  text: text,
  subject: text.optional(),
  channelHandleHash: nonempty,
  identityStatus: z.literal("unverified"),
  receivedAt: instant,
  structuredPart: z.array(json).max(512),
});
const conversationTurn = z.strictObject({
  type: z.literal("conversation-turn"),
  id: iri,
  conversation: iri,
  attributedTo: iri,
  role: z.enum(["owner", "agent"]),
  text,
  createdAt: instant,
  refersToProposal: z.array(iri).max(512),
});
const actionProposal = z.strictObject({
  type: z.literal("action-proposal"),
  id: iri,
  intent: actionIntentSchema,
  renderedPreview: text,
  wasGeneratedBy: iri,
  createdAt: instant,
  validUntil: instant,
  state: z.enum(["proposed", "approved", "denied", "expired", "sent", "failed"]),
});
const approval = z.strictObject({
  type: z.literal("approval"),
  id: iri,
  approves: iri,
  termsDigest: nonempty,
  expires: instant,
  decision: z.enum(["approve", "deny"]),
  attributedTo: iri,
  createdAt: instant,
  proof,
});
const mandateReference = z.strictObject({
  type: z.literal("mandate-reference"),
  id: iri,
  credential: iri,
  credentialStatus: iri.optional(),
  digest: nonempty,
  validFrom: instant,
  validUntil: instant,
  proof,
});
const controlStatement = z
  .strictObject({
    type: z.literal("control-statement"),
    id: iri,
    kind: z.enum(["Halt", "Resume", "SetBindingState", "DispatchNow", "RevokeMandate", "Forget"]),
    attributedTo: iri,
    createdAt: instant,
    expires: instant,
    target: iri.optional(),
    binding: nonempty.optional(),
    bindingState: bindingStateSchema.optional(),
    proof,
  })
  .superRefine((value, ctx) => {
    if (value.kind === "SetBindingState" && (!value.binding || !value.bindingState)) {
      ctx.addIssue({
        code: "custom",
        message: "SetBindingState requires binding and bindingState",
      });
    }
    if (["DispatchNow", "RevokeMandate", "Forget"].includes(value.kind) && !value.target) {
      ctx.addIssue({ code: "custom", message: "control statement requires target" });
    }
  });
const transmission = z.strictObject({
  type: z.literal("transmission"),
  id: iri,
  proposal: iri,
  status: z.enum(["attempting", "sent", "not-sent", "uncertain", "refused"]),
  externalId: text.optional(),
  wireDigest: nonempty,
  underMandate: iri,
  underApproval: iri.optional(),
  startedAt: instant,
  endedAt: instant.optional(),
});
const auditEntry = z.strictObject({
  type: z.literal("audit-entry"),
  id: iri,
  seq: count,
  at: instant,
  prev: nonempty,
  hash: nonempty,
  record: z.custom<Record<string, JsonValue> & { type: string }>(
    (value) => isJsonObject(value) && nonempty.safeParse(value.type).success,
    "expected JSON object with a nonempty type",
  ),
});

/** The ten graph families in DESIGN §2.4. Mandates are opaque credential references. */
export const podRecordSchema = z.discriminatedUnion("type", [
  account,
  channelCapability,
  inboundMessage,
  conversationTurn,
  actionProposal,
  approval,
  mandateReference,
  controlStatement,
  transmission,
  auditEntry,
]);
export type PodRecord = z.infer<typeof podRecordSchema>;
export type RecordType = PodRecord["type"];
export type Account = Extract<PodRecord, { type: "account" }>;
export type ChannelCapability = Extract<PodRecord, { type: "channel-capability" }>;
export type InboundMessage = Extract<PodRecord, { type: "inbound-message" }>;
export type ConversationTurn = Extract<PodRecord, { type: "conversation-turn" }>;
export type ActionProposal = Extract<PodRecord, { type: "action-proposal" }>;
export type Approval = Extract<PodRecord, { type: "approval" }>;
export type MandateReference = Extract<PodRecord, { type: "mandate-reference" }>;
export type ControlStatement = Extract<PodRecord, { type: "control-statement" }>;
export type Transmission = Extract<PodRecord, { type: "transmission" }>;
export type AuditEntry = Extract<PodRecord, { type: "audit-entry" }>;
/** Structural ledger entry, independent of filesystem ledger implementations. */
export interface LedgerEntry {
  readonly seq: number;
  readonly at: string;
  readonly prev: string;
  readonly hash: string;
  readonly record: { readonly type: string; readonly [key: string]: unknown };
}
