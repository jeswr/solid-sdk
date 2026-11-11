// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, digestOf, isIri } from "@jeswr/agent-model";
import { z } from "zod";

/** No free-form payloads: audit records contain references, digests and counts only. */
export const ENTRY_KINDS = [
  "ingest",
  "proposal",
  "decision",
  "approval-seen",
  "transmission",
  "receipt",
  "control",
  "mandate-change",
  "model-call",
  "tool-call",
  "tamper-suspected",
  "conversation",
  "personal-data-read",
] as const;
const iri = z
  .string()
  .max(2048)
  .refine(isIri)
  .refine((value) => !/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(value));
const label = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
const instrumentationLabel = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !/[^a-zA-Z0-9_.-]/.test(value));
/** Opaque runtime-assigned experiment label; never a prompt or user-supplied title. */
export const taskIdSchema = instrumentationLabel;
export const digestSchema = z.string().regex(/^sha-256:[a-f0-9]{64}$/);
export const recipientHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const instantSchema = z.iso.datetime({ precision: 3 });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Exact body-free terms signed by an approval. Hash the message bytes separately. */
export const termsSchema = z.strictObject({
  action: iri,
  target: iri,
  binding: label,
  accountId: label,
  recipientHashes: z.array(recipientHashSchema).min(1).max(100),
  messageDigest: digestSchema,
  purpose: iri.optional(),
  /** Commits the executor's full intent, carrier, preview and expiry without exposing them. */
  proposalDigest: digestSchema.optional(),
});
const recordSchema = z
  .strictObject({
    type: z.enum(ENTRY_KINDS),
    id: iri,
    agent: iri,
    owner: iri,
    taskId: taskIdSchema.optional(),
    conversation: iri.optional(),
    proposal: iri.optional(),
    mandate: iri.optional(),
    approval: iri.optional(),
    decisionRecord: iri.optional(),
    transmission: iri.optional(),
    receipt: iri.optional(),
    terms: termsSchema.optional(),
    termsDigest: digestSchema.optional(),
    messageDigest: digestSchema.optional(),
    decision: z.enum(["permit", "confirm-required", "prohibited", "refuse-all"]).optional(),
    status: z.enum(["attempting", "sent", "not-sent", "uncertain", "refused"]).optional(),
    reason: label.optional(),
    purpose: iri.optional(),
    categories: z.array(iri).max(64).optional(),
    resources: z.array(iri).max(100).optional(),
    accountId: label.optional(),
    recipientHashes: z.array(recipientHashSchema).max(100).optional(),
    context: z.enum(["reader", "proposer"]).optional(),
    provider: z.enum(["openai", "anthropic"]).optional(),
    model: label.optional(),
    modelCall: iri.optional(),
    tool: instrumentationLabel.optional(),
    tokens: count.optional(),
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    toolCalls: count.optional(),
    latencyMs: count.optional(),
    retries: count.optional(),
  })
  .superRefine((record, context) => {
    const fields =
      record.type === "personal-data-read"
        ? (["tool", "decision", "reason", "categories", "resources"] as const)
        : (["purpose", "categories", "resources"] as const);
    for (const field of fields) {
      if ((record[field] !== undefined) !== (record.type === "personal-data-read"))
        context.addIssue({ code: "custom", path: [field], message: "Invalid audit record fields" });
    }
  });
const checkpointSchema = z.strictObject({
  type: z.literal("ledger-checkpoint"),
  lastPrunedSeq: count.min(1),
  lastPrunedHash: digestSchema,
});
export const ledgerRecordSchema = z.union([recordSchema, checkpointSchema]);
export type AuditRecord = z.infer<typeof recordSchema>;
export type AuditTerms = z.infer<typeof termsSchema>;
export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;
export const GENESIS = "sha-256:genesis";
/** Maximum published sequence the pod reader and mirror can process. */
export const MAX_AUDIT_SEQ = 200000;
export const entrySchema = z.strictObject({
  seq: count.min(1),
  at: instantSchema,
  prev: z.union([digestSchema, z.literal(GENESIS)]),
  record: ledgerRecordSchema,
  hash: digestSchema,
});
export type LedgerEntry = z.infer<typeof entrySchema>;

/** Reject getters, cycles and lossy JSON before validating the privacy allowlist. */
export function checkedRecord(value: unknown): LedgerRecord {
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > 65536) throw new Error("Audit record exceeds bound");
  return ledgerRecordSchema.parse(JSON.parse(json));
}
export function seal(seq: number, at: string, prev: string, value: unknown): LedgerEntry {
  const record = checkedRecord(value);
  return entrySchema.parse({ seq, at, prev, record, hash: digestOf({ seq, at, prev, record }) });
}
